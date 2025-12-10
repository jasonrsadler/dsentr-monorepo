use std::time::Duration;

#[cfg(test)]
use std::sync::Arc;

use crate::engine::{complete_run_with_retry, execute_run, ExecutorError};
use crate::models::workflow_run::WorkflowRun;
use crate::models::workflow_run_event::NewWorkflowRunEvent;
use crate::models::workflow_schedule::WorkflowSchedule;
use crate::runaway_protection::{
    enforce_runaway_protection, runaway_protection_enabled, RunawayProtectionError,
    RUNAWAY_PROTECTION_ERROR,
};
use crate::state::{AppState, WorkspaceLimitError, WorkspaceRunQuotaTicket};
#[cfg(test)]
use crate::utils::jwt::JwtKeys;
use crate::utils::schedule::{
    compute_next_run, offset_to_utc, parse_schedule_config, utc_to_offset,
};
use crate::utils::workflow_connection_metadata;
use chrono::Utc;
use serde_json::{json, Value};
use tokio::task::JoinSet;
use tokio::time::{sleep, timeout};
use tracing::{error, warn};
use uuid::Uuid;

#[cfg(test)]
fn test_jwt_keys() -> Arc<JwtKeys> {
    Arc::new(
        JwtKeys::from_secret("0123456789abcdef0123456789abcdef")
            .expect("test JWT secret should be valid"),
    )
}

pub async fn start_background_workers(state: AppState) {
    // Simple single-worker for now. Can be extended to multiple tasks.
    tokio::spawn(async move {
        if let Err(err) = worker_loop(state).await {
            error!(
                run_id = %err.run_id(),
                operation = err.operation(),
                attempts = err.attempts(),
                error = %err,
                "worker loop terminated due to executor persistence failure"
            );
        }
    });
}

async fn worker_loop(state: AppState) -> Result<(), ExecutorError> {
    // Periodic retention cleanup
    let retention_days: i32 = std::env::var("RUN_RETENTION_DAYS")
        .ok()
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(30);
    let mut last_cleanup = std::time::Instant::now();
    let mut last_schedule_check = std::time::Instant::now();
    let use_leases = std::env::var("WORKER_USE_LEASES")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(true);
    let max_inflight = worker_pool_size();
    let run_deadline = run_deadline_duration(state.worker_lease_seconds);
    let mut inflight: JoinSet<(Uuid, Result<(), ExecutorError>)> = JoinSet::new();
    loop {
        while let Some(join_result) = inflight.try_join_next() {
            match join_result {
                Ok((_, Ok(()))) => {}
                Ok((_, Err(err))) => return Err(err),
                Err(err) => {
                    warn!(?err, "worker: run task panicked");
                }
            }
        }

        if last_cleanup.elapsed() > Duration::from_secs(600) {
            if let Err(err) = state.workflow_repo.purge_old_runs(retention_days).await {
                warn!(
                    worker_id = %state.worker_id,
                    error = ?err,
                    "worker: failed to purge old runs"
                );
            }
            last_cleanup = std::time::Instant::now();
        }

        if last_schedule_check.elapsed() > Duration::from_secs(5) {
            if let Err(err) = process_due_schedules(&state).await {
                warn!(
                    worker_id = %state.worker_id,
                    error = ?err,
                    "worker: error processing schedules"
                );
            }
            last_schedule_check = std::time::Instant::now();
        }
        if use_leases {
            // Requeue any expired leases before claiming
            if let Err(err) = state.workflow_repo.requeue_expired_leases().await {
                warn!(?err, "worker: failed to requeue expired leases");
            }
        }

        if inflight.len() >= max_inflight {
            sleep(Duration::from_millis(100)).await;
            continue;
        }
        let claim_res = if use_leases {
            state
                .workflow_repo
                .claim_next_eligible_run(&state.worker_id, state.worker_lease_seconds)
                .await
        } else {
            state.workflow_repo.claim_next_queued_run().await
        };

        match claim_res {
            Ok(Some(run)) => {
                let state_clone = state.clone();
                let deadline = run_deadline;
                inflight.spawn(async move { run_with_deadline(state_clone, run, deadline).await });
            }
            Ok(None) => {
                if inflight.is_empty() {
                    sleep(Duration::from_millis(750)).await;
                } else {
                    sleep(Duration::from_millis(250)).await;
                }
            }
            Err(e) => {
                warn!(
                    worker_id = %state.worker_id,
                    error = ?e,
                    "worker: error claiming run"
                );
                sleep(Duration::from_millis(1000)).await;
            }
        }
    }
}

fn worker_pool_size() -> usize {
    std::env::var("WORKER_MAX_INFLIGHT_RUNS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(4)
}

fn run_deadline_duration(lease_seconds: i32) -> Duration {
    let env_deadline = std::env::var("WORKER_RUN_DEADLINE_SECONDS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .map(Duration::from_secs);

    match env_deadline {
        Some(duration) => duration,
        None => {
            let base = lease_seconds.max(1) as u64;
            if base > 5 {
                Duration::from_secs(base - 5)
            } else {
                Duration::from_secs(base)
            }
        }
    }
}

async fn block_run_if_runaway(state: &AppState, run: &WorkflowRun) -> Result<bool, ExecutorError> {
    let Some(workspace_id) = run.workspace_id else {
        return Ok(false);
    };

    let settings = match state.db.get_user_settings(run.user_id).await {
        Ok(val) => val,
        Err(err) => {
            warn!(
                run_id = %run.id,
                workflow_id = %run.workflow_id,
                %workspace_id,
                ?err,
                "worker: failed to load user settings for runaway protection check"
            );
            complete_run_with_retry(state, run.id, "failed", Some(RUNAWAY_PROTECTION_ERROR))
                .await?;
            return Ok(true);
        }
    };

    if !runaway_protection_enabled(&settings, workspace_id) {
        return Ok(false);
    }

    match enforce_runaway_protection(state, workspace_id, &settings).await {
        Ok(()) => Ok(false),
        Err(RunawayProtectionError::RunawayProtectionTriggered { count, limit }) => {
            warn!(
                run_id = %run.id,
                workflow_id = %run.workflow_id,
                %workspace_id,
                %count,
                %limit,
                worker_id = %state.worker_id,
                "runaway protection triggered; failing run without execution"
            );
            let event = NewWorkflowRunEvent {
                workflow_run_id: run.id,
                workflow_id: run.workflow_id,
                workspace_id: run.workspace_id,
                triggered_by: format!("worker:{}", state.worker_id.as_ref()),
                connection_type: Some(RUNAWAY_PROTECTION_ERROR.to_string()),
                connection_id: None,
                recorded_at: None,
            };
            if let Err(err) = state.workflow_repo.record_run_event(event).await {
                warn!(
                    ?err,
                    run_id = %run.id,
                    workflow_id = %run.workflow_id,
                    "failed to record runaway protection run event"
                );
            }
            complete_run_with_retry(state, run.id, "failed", Some(RUNAWAY_PROTECTION_ERROR))
                .await?;
            Ok(true)
        }
        Err(RunawayProtectionError::Database(err)) => {
            warn!(
                ?err,
                run_id = %run.id,
                workflow_id = %run.workflow_id,
                %workspace_id,
                "worker: runaway protection enforcement failed"
            );
            complete_run_with_retry(state, run.id, "failed", Some(RUNAWAY_PROTECTION_ERROR))
                .await?;
            Ok(true)
        }
    }
}

async fn run_with_deadline(
    state: AppState,
    run: WorkflowRun,
    deadline: Duration,
) -> (Uuid, Result<(), ExecutorError>) {
    let run_id = run.id;

    let blocked = match block_run_if_runaway(&state, &run).await {
        Ok(blocked) => blocked,
        Err(err) => return (run_id, Err(err)),
    };
    if blocked {
        return (run_id, Ok(()));
    }

    if deadline.is_zero() {
        return (run_id, execute_run(state, run).await.map(|_| ()));
    }

    match timeout(deadline, execute_run(state.clone(), run)).await {
        Ok(result) => (run_id, result.map(|_| ())),
        Err(_) => {
            warn!(
                %run_id,
                worker_id = %state.worker_id,
                deadline_secs = deadline.as_secs(),
                "worker: run execution exceeded deadline"
            );
            let res = complete_run_with_retry(
                &state,
                run_id,
                "failed",
                Some("Worker execution deadline exceeded"),
            )
            .await;
            match res {
                Ok(()) => (run_id, Ok(())),
                Err(err) => (run_id, Err(err)),
            }
        }
    }
}

async fn process_due_schedules(state: &AppState) -> Result<(), sqlx::Error> {
    const MAX_SCHEDULES: i64 = 10;
    let schedules = state
        .workflow_repo
        .list_due_schedules(MAX_SCHEDULES)
        .await?;
    for schedule in schedules {
        let schedule_id = schedule.id;
        if let Err(err) = trigger_schedule(state, schedule).await {
            error!(
                worker_id = %state.worker_id,
                schedule_id = %schedule_id,
                error = ?err,
                "worker: failed to trigger schedule"
            );
        }
    }
    Ok(())
}

async fn trigger_schedule(state: &AppState, schedule: WorkflowSchedule) -> Result<(), sqlx::Error> {
    let config = match parse_schedule_config(&schedule.config) {
        Some(cfg) => cfg,
        None => {
            state
                .workflow_repo
                .disable_workflow_schedule(schedule.workflow_id)
                .await?;
            return Ok(());
        }
    };

    let next_time = match schedule.next_run_at {
        Some(ts) => ts,
        None => {
            state
                .workflow_repo
                .disable_workflow_schedule(schedule.workflow_id)
                .await?;
            return Ok(());
        }
    };

    let last_run_utc = match offset_to_utc(next_time) {
        Some(dt) => dt,
        None => {
            state
                .workflow_repo
                .disable_workflow_schedule(schedule.workflow_id)
                .await?;
            return Ok(());
        }
    };

    let workflow_opt = state
        .workflow_repo
        .find_workflow_by_id(schedule.user_id, schedule.workflow_id)
        .await?;

    let workflow = match workflow_opt {
        Some(w) => w,
        None => {
            state
                .workflow_repo
                .disable_workflow_schedule(schedule.workflow_id)
                .await?;
            return Ok(());
        }
    };

    let settings = match state.db.get_user_settings(schedule.user_id).await {
        Ok(val) => val,
        Err(err) => {
            warn!(
                worker_id = %state.worker_id,
                user_id = %schedule.user_id,
                ?err,
                "worker: failed to load user settings for schedule"
            );
            Value::Object(Default::default())
        }
    };

    let mut snapshot = workflow.data.clone();
    snapshot["_egress_allowlist"] = Value::Array(
        workflow
            .egress_allowlist
            .iter()
            .cloned()
            .map(Value::String)
            .collect(),
    );

    let mut context = snapshot
        .get("_trigger_context")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if let Value::Object(ref mut map) = context {
        map.insert("scheduled".to_string(), Value::Bool(true));
        map.insert(
            "scheduleId".to_string(),
            Value::String(schedule.id.to_string()),
        );
        map.insert(
            "scheduledFor".to_string(),
            Value::String(next_time.to_string()),
        );
        map.insert("scheduleConfig".to_string(), schedule.config.clone());
    } else {
        context = json!({
            "scheduled": true,
            "scheduleId": schedule.id,
            "scheduledFor": next_time.to_string(),
            "scheduleConfig": schedule.config.clone(),
        });
    }
    snapshot["_trigger_context"] = context;

    if let Some(start_id) = find_schedule_trigger_start_node(&snapshot, &schedule.config) {
        snapshot["_start_from_node"] = Value::String(start_id);
    }

    let connection_metadata = workflow_connection_metadata::collect(&snapshot);
    workflow_connection_metadata::embed(&mut snapshot, &connection_metadata);

    let mut workspace_quota: Option<WorkspaceRunQuotaTicket> = None;
    let mut skip_run = false;
    if let Some(workspace_id) = workflow.workspace_id {
        match enforce_runaway_protection(state, workspace_id, &settings).await {
            Ok(()) => {}
            Err(RunawayProtectionError::RunawayProtectionTriggered { count, limit }) => {
                warn!(
                    worker_id = %state.worker_id,
                    %workspace_id,
                    %schedule.id,
                    %count,
                    %limit,
                    "runaway protection blocked scheduled run creation"
                );
                skip_run = true;
            }
            Err(RunawayProtectionError::Database(err)) => {
                return Err(err);
            }
        }

        if !skip_run {
            match state.consume_workspace_run_quota(workspace_id).await {
                Ok(Some(ticket)) => {
                    if ticket.run_count > ticket.limit {
                        warn!(
                            worker_id = %state.worker_id,
                            %workspace_id,
                            overage_count = ticket.overage_count,
                            run_count = ticket.run_count,
                            %schedule.id,
                            %ticket.limit,
                            "workspace run overage recorded for scheduled run"
                        );
                    }
                    workspace_quota = Some(ticket);
                }
                Ok(None) => {}
                Err(WorkspaceLimitError::WorkspacePlanRequired) => {
                    warn!(
                        worker_id = %state.worker_id,
                        %workspace_id,
                        schedule_id = %schedule.id,
                        "skipping scheduled run because workspace reverted to the Solo plan"
                    );
                    skip_run = true;
                }
                Err(WorkspaceLimitError::RunLimitReached { limit }) => {
                    warn!(
                        worker_id = %state.worker_id,
                        %workspace_id,
                        schedule_id = %schedule.id,
                        %limit,
                        "workspace run usage exceeded limit; continuing and recording overage"
                    );
                }
                Err(WorkspaceLimitError::MemberLimitReached { limit }) => {
                    warn!(
                        worker_id = %state.worker_id,
                        %workspace_id,
                        schedule_id = %schedule.id,
                        %limit,
                        "unexpected member limit error while triggering schedule"
                    );
                    skip_run = true;
                }
                Err(WorkspaceLimitError::Database(err)) => {
                    return Err(err);
                }
            }
        }
    }

    if !skip_run {
        let outcome = match state
            .workflow_repo
            .create_workflow_run(
                schedule.user_id,
                schedule.workflow_id,
                workflow.workspace_id,
                snapshot,
                None,
            )
            .await
        {
            Ok(outcome) => outcome,
            Err(err) => {
                if let Some(ticket) = workspace_quota {
                    let _ = state.release_workspace_run_quota(ticket).await;
                }
                return Err(err);
            }
        };

        if let (Some(ticket), false) = (&workspace_quota, outcome.created) {
            let _ = state.release_workspace_run_quota(*ticket).await;
        }

        let run = outcome.run;
        let triggered_by = format!("schedule:{}", schedule.id);
        let events = workflow_connection_metadata::build_run_events(
            &run,
            &triggered_by,
            &connection_metadata,
        );
        for event in events {
            state.workflow_repo.record_run_event(event).await?;
        }
    }

    let now = Utc::now();
    let next_dt = compute_next_run(&config, Some(last_run_utc), now);
    let last_offset = match utc_to_offset(now) {
        Some(v) => v,
        None => {
            state
                .workflow_repo
                .disable_workflow_schedule(schedule.workflow_id)
                .await?;
            return Ok(());
        }
    };
    let next_offset = next_dt.and_then(utc_to_offset);
    state
        .workflow_repo
        .mark_schedule_run(schedule.id, last_offset, next_offset)
        .await?;

    Ok(())
}

fn find_schedule_trigger_start_node(snapshot: &Value, schedule_config: &Value) -> Option<String> {
    let nodes = snapshot.get("nodes")?.as_array()?;
    let mut fallback: Option<String> = None;

    for node in nodes {
        let Some(node_type) = node.get("type").and_then(|v| v.as_str()) else {
            continue;
        };
        if !node_type.eq_ignore_ascii_case("trigger") {
            continue;
        }
        let Some(id) = node.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let data = node.get("data").and_then(|v| v.as_object());
        let trigger_type = data
            .and_then(|map| map.get("triggerType"))
            .and_then(|v| v.as_str())
            .unwrap_or("Manual");
        if !trigger_type.eq_ignore_ascii_case("schedule") {
            continue;
        }
        if let Some(map) = data {
            if let Some(cfg) = map.get("scheduleConfig") {
                if cfg == schedule_config {
                    return Some(id.to_string());
                }
            }
        }
        if fallback.is_none() {
            fallback = Some(id.to_string());
        }
    }

    fallback
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        Config, OAuthProviderConfig, OAuthSettings, StripeSettings, DEFAULT_WORKSPACE_MEMBER_LIMIT,
        DEFAULT_WORKSPACE_MONTHLY_RUN_LIMIT, RUNAWAY_LIMIT_5MIN,
    };
    use crate::db::mock_db::{
        MockDb, NoopWorkspaceRepository, StaticWorkspaceMembershipRepository,
    };
    use crate::db::mock_stripe_event_log_repository::MockStripeEventLogRepository;
    use crate::db::workflow_repository::{MockWorkflowRepository, WorkflowRepository};
    use crate::db::workspace_connection_repository::NoopWorkspaceConnectionRepository;
    use crate::models::workflow::Workflow;
    use crate::models::workflow_node_run::WorkflowNodeRun;
    use crate::models::workflow_run::WorkflowRun;
    use crate::models::workflow_run_event::{NewWorkflowRunEvent, WorkflowRunEvent};
    use crate::models::workflow_schedule::WorkflowSchedule;
    use crate::services::oauth::account_service::OAuthAccountService;
    use crate::services::oauth::github::mock_github_oauth::MockGitHubOAuth;
    use crate::services::oauth::google::mock_google_oauth::MockGoogleOAuth;
    use crate::services::oauth::workspace_service::WorkspaceOAuthService;
    use crate::services::smtp_mailer::MockMailer;
    use crate::state::{test_pg_pool, AppState};
    use mockall::predicate;
    use reqwest::Client;
    use serde_json::json;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use time::{Duration as TimeDuration, OffsetDateTime};
    use uuid::Uuid;

    fn build_executor_failure_state() -> AppState {
        let run = WorkflowRun {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            workflow_id: Uuid::new_v4(),
            workspace_id: Some(Uuid::new_v4()),
            snapshot: json!({
                "nodes": [
                    {"id": "trigger", "type": "trigger", "data": json!({"label": "Trigger"})}
                ],
                "edges": []
            }),
            status: "running".into(),
            error: None,
            idempotency_key: None,
            started_at: OffsetDateTime::now_utc(),
            resume_at: OffsetDateTime::now_utc(),
            finished_at: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        };

        let mut repo = MockWorkflowRepository::new();
        repo.expect_list_due_schedules()
            .returning(|_| Box::pin(async { Ok(Vec::new()) }));
        repo.expect_requeue_expired_leases()
            .returning(|| Box::pin(async { Ok(0) }));
        repo.expect_count_workspace_runs_since()
            .returning(|_, _| Box::pin(async { Ok(0) }));
        let run_queue = Arc::new(Mutex::new(VecDeque::from([run.clone()])));
        let run_queue_claim = Arc::clone(&run_queue);
        repo.expect_claim_next_eligible_run()
            .returning(move |_, _| {
                let run_queue = Arc::clone(&run_queue_claim);
                Box::pin(async move { Ok(run_queue.lock().unwrap().pop_front()) })
            });
        repo.expect_record_run_event()
            .times(3)
            .returning(|_| Box::pin(async { Err(sqlx::Error::RowNotFound) }));

        let workflow_repo: Arc<dyn WorkflowRepository> = Arc::new(repo);
        let config = Arc::new(Config {
            database_url: String::new(),
            frontend_origin: "http://localhost".into(),
            admin_origin: "http://localhost".into(),
            oauth: OAuthSettings {
                google: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                microsoft: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                slack: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                asana: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                token_encryption_key: vec![0u8; 32],
            },
            api_secrets_encryption_key: vec![1u8; 32],
            stripe: StripeSettings {
                client_id: "stub".into(),
                secret_key: "stub".into(),
                webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            },
            auth_cookie_secure: true,
            webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            jwt_issuer: "test-issuer".into(),
            jwt_audience: "test-audience".into(),
            workspace_member_limit: DEFAULT_WORKSPACE_MEMBER_LIMIT,
            workspace_monthly_run_limit: DEFAULT_WORKSPACE_MONTHLY_RUN_LIMIT,
            runaway_limit_5min: RUNAWAY_LIMIT_5MIN,
        });

        AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo,
            workspace_repo: Arc::new(NoopWorkspaceRepository),
            workspace_connection_repo: Arc::new(NoopWorkspaceConnectionRepository),
            stripe_event_log_repo: Arc::new(MockStripeEventLogRepository::default()),
            db_pool: test_pg_pool(),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts: OAuthAccountService::test_stub(),
            workspace_oauth: WorkspaceOAuthService::test_stub(),
            stripe: Arc::new(crate::services::stripe::MockStripeService::new()),
            http_client: Arc::new(Client::new()),
            config,
            worker_id: Arc::new("worker".into()),
            worker_lease_seconds: 30,
            jwt_keys: test_jwt_keys(),
        }
    }

    struct EnvGuard {
        key: &'static str,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: &str) -> Self {
            std::env::set_var(key, value);
            EnvGuard { key }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            std::env::remove_var(self.key);
        }
    }

    #[tokio::test]
    async fn worker_loop_surfaces_executor_failures() {
        let _max_guard = EnvGuard::set("WORKER_MAX_INFLIGHT_RUNS", "1");
        let _deadline_guard = EnvGuard::set("WORKER_RUN_DEADLINE_SECONDS", "0");
        let state = build_executor_failure_state();

        let result =
            tokio::time::timeout(std::time::Duration::from_millis(500), worker_loop(state))
                .await
                .expect("worker loop should complete");

        let err = result.expect_err("expected executor error");
        assert_eq!(err.operation(), "record_run_event");
    }

    #[tokio::test]
    async fn worker_loop_initializes_with_structured_logging() {
        let subscriber = tracing_subscriber::fmt().with_test_writer().json().finish();
        let _guard = tracing::subscriber::set_default(subscriber);

        let _max_guard = EnvGuard::set("WORKER_MAX_INFLIGHT_RUNS", "1");
        let _deadline_guard = EnvGuard::set("WORKER_RUN_DEADLINE_SECONDS", "0");
        let state = build_executor_failure_state();

        let result =
            tokio::time::timeout(std::time::Duration::from_millis(500), worker_loop(state))
                .await
                .expect("worker loop should complete");

        assert!(
            result.is_err(),
            "worker loop should surface executor errors"
        );
    }

    #[tokio::test]
    async fn worker_handles_slow_runs_with_fresh_leases() {
        let _max_guard = EnvGuard::set("WORKER_MAX_INFLIGHT_RUNS", "2");
        let _deadline_guard = EnvGuard::set("WORKER_RUN_DEADLINE_SECONDS", "0");
        let _renew_guard = EnvGuard::set("RUN_LEASE_RENEWAL_INTERVAL_MS", "100");

        let workflow_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let workspace_id = Some(Uuid::new_v4());
        let snapshot = json!({
            "nodes": [
                {"id": "trigger", "type": "trigger", "data": json!({"label": "Trigger"})},
                {"id": "check1", "type": "condition", "data": json!({"label": "Check 1", "expression": "1 == 1"})},
                {"id": "check2", "type": "condition", "data": json!({"label": "Check 2", "expression": "1 == 1"})}
            ],
            "edges": [
                {"source": "trigger", "target": "check1"},
                {"source": "check1", "target": "check2"}
            ]
        });

        let build_run = |id: Uuid| WorkflowRun {
            id,
            user_id,
            workflow_id,
            workspace_id,
            snapshot: snapshot.clone(),
            status: "running".into(),
            error: None,
            idempotency_key: None,
            started_at: OffsetDateTime::now_utc(),
            resume_at: OffsetDateTime::now_utc(),
            finished_at: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        };

        let runs_queue = Arc::new(Mutex::new(VecDeque::from([
            build_run(Uuid::new_v4()),
            build_run(Uuid::new_v4()),
        ])));
        let completed: Arc<Mutex<Vec<(Uuid, String)>>> = Arc::new(Mutex::new(Vec::new()));
        let renew_count = Arc::new(AtomicUsize::new(0));

        let mut repo = MockWorkflowRepository::new();
        repo.expect_list_due_schedules()
            .returning(|_| Box::pin(async { Ok(Vec::new()) }));
        repo.expect_requeue_expired_leases()
            .returning(|| Box::pin(async { Ok(0) }));
        repo.expect_count_workspace_runs_since()
            .returning(|_, _| Box::pin(async { Ok(0) }));
        let runs_queue_claim = Arc::clone(&runs_queue);
        repo.expect_claim_next_eligible_run()
            .returning(move |_, _| {
                let queue = Arc::clone(&runs_queue_claim);
                Box::pin(async move { Ok(queue.lock().unwrap().pop_front()) })
            });
        repo.expect_get_run_status()
            .returning(|_| Box::pin(async { Ok(Some("running".to_string())) }));
        let renew_calls = Arc::clone(&renew_count);
        repo.expect_renew_run_lease()
            .returning(move |run_id, _, _| {
                let renew_calls = Arc::clone(&renew_calls);
                Box::pin(async move {
                    let _ = run_id;
                    renew_calls.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                })
            });
        repo.expect_upsert_node_run().returning(
            move |run_id, node_id, name, node_type, inputs, outputs, status, error| {
                let node_id = node_id.to_owned();
                let name = name.map(|s| s.to_owned());
                let node_type = node_type.map(|s| s.to_owned());
                let status = status.to_owned();
                let error = error.map(|s| s.to_owned());
                let inputs = inputs.clone();
                let outputs = outputs.clone();

                Box::pin(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    Ok(WorkflowNodeRun {
                        id: Uuid::new_v4(),
                        run_id,
                        node_id,
                        name,
                        node_type,
                        inputs,
                        outputs,
                        status,
                        error,
                        started_at: OffsetDateTime::now_utc(),
                        finished_at: None,
                        created_at: OffsetDateTime::now_utc(),
                        updated_at: OffsetDateTime::now_utc(),
                    })
                })
            },
        );
        let completed_for_repo = Arc::clone(&completed);
        repo.expect_complete_workflow_run()
            .returning(move |run_id, status, _| {
                let completed = Arc::clone(&completed_for_repo);
                let status = status.to_string();
                Box::pin(async move {
                    completed.lock().unwrap().push((run_id, status));
                    Ok(())
                })
            });
        repo.expect_record_run_event().returning(|event| {
            Box::pin(async move {
                Ok(WorkflowRunEvent {
                    id: Uuid::new_v4(),
                    workflow_run_id: event.workflow_run_id,
                    workflow_id: event.workflow_id,
                    workspace_id: event.workspace_id,
                    triggered_by: event.triggered_by,
                    connection_type: event.connection_type,
                    connection_id: event.connection_id,
                    recorded_at: event.recorded_at.unwrap_or_else(OffsetDateTime::now_utc),
                })
            })
        });

        let workflow_repo: Arc<dyn WorkflowRepository> = Arc::new(repo);
        let config = Arc::new(Config {
            database_url: String::new(),
            frontend_origin: "http://localhost".into(),
            admin_origin: "http://localhost".into(),
            oauth: OAuthSettings {
                google: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                microsoft: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                slack: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                asana: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                token_encryption_key: vec![0u8; 32],
            },
            api_secrets_encryption_key: vec![1u8; 32],
            stripe: StripeSettings {
                client_id: "stub".into(),
                secret_key: "stub".into(),
                webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            },
            auth_cookie_secure: true,
            webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            jwt_issuer: "test-issuer".into(),
            jwt_audience: "test-audience".into(),
            workspace_member_limit: DEFAULT_WORKSPACE_MEMBER_LIMIT,
            workspace_monthly_run_limit: DEFAULT_WORKSPACE_MONTHLY_RUN_LIMIT,
            runaway_limit_5min: RUNAWAY_LIMIT_5MIN,
        });

        let state = AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo,
            workspace_repo: Arc::new(NoopWorkspaceRepository),
            workspace_connection_repo: Arc::new(NoopWorkspaceConnectionRepository),
            stripe_event_log_repo: Arc::new(MockStripeEventLogRepository::default()),
            db_pool: test_pg_pool(),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts: OAuthAccountService::test_stub(),
            workspace_oauth: WorkspaceOAuthService::test_stub(),
            stripe: Arc::new(crate::services::stripe::MockStripeService::new()),
            http_client: Arc::new(Client::new()),
            config,
            worker_id: Arc::new("worker".into()),
            worker_lease_seconds: 3,
            jwt_keys: test_jwt_keys(),
        };

        let worker_state = state.clone();
        let worker_task = tokio::spawn(async move {
            let _ = worker_loop(worker_state).await;
        });

        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if completed.lock().unwrap().len() >= 2 {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        })
        .await
        .expect("worker processed both runs");

        worker_task.abort();

        let finished = completed.lock().unwrap().clone();
        assert_eq!(finished.len(), 2, "expected both runs to finish");
        assert!(
            finished.iter().all(|(_, status)| status == "succeeded"),
            "runs should succeed"
        );

        assert!(
            renew_count.load(Ordering::SeqCst) >= 2,
            "lease renewals should occur for slow runs",
        );
    }

    #[tokio::test]
    async fn worker_continues_on_missing_connection_event() {
        // Ensure the worker doesn't terminate when a run event references a deleted connection.
        let _max_guard = EnvGuard::set("WORKER_MAX_INFLIGHT_RUNS", "1");
        let _deadline_guard = EnvGuard::set("WORKER_RUN_DEADLINE_SECONDS", "0");

        // Build a run snapshot that includes a workspace connection reference.
        let conn_id = Uuid::new_v4();
        let run = WorkflowRun {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            workflow_id: Uuid::new_v4(),
            workspace_id: Some(Uuid::new_v4()),
            snapshot: json!({
                "nodes": [
                    {"id": "trigger", "type": "trigger", "data": json!({
                        "label": "Trigger",
                        "connection": {"connectionScope": "workspace", "connectionId": conn_id}
                    })}
                ],
                "edges": []
            }),
            status: "running".into(),
            error: None,
            idempotency_key: None,
            started_at: OffsetDateTime::now_utc(),
            resume_at: OffsetDateTime::now_utc(),
            finished_at: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        };

        let mut repo = MockWorkflowRepository::new();
        // Only one run to claim.
        let run_queue = Arc::new(Mutex::new(VecDeque::from([run.clone()])));
        let claim_queue = Arc::clone(&run_queue);
        repo.expect_list_due_schedules()
            .returning(|_| Box::pin(async { Ok(Vec::new()) }));
        repo.expect_requeue_expired_leases()
            .returning(|| Box::pin(async { Ok(0) }));
        repo.expect_count_workspace_runs_since()
            .returning(|_, _| Box::pin(async { Ok(0) }));
        repo.expect_claim_next_eligible_run()
            .returning(move |_, _| {
                let q = Arc::clone(&claim_queue);
                Box::pin(async move { Ok(q.lock().unwrap().pop_front()) })
            });

        // When the executor attempts to record the run event, it should have already
        // downgraded the missing connection reference to a safe fallback.
        repo.expect_record_run_event().returning(|event| {
            assert_eq!(event.connection_type.as_deref(), Some("connection_missing"));
            assert_eq!(event.connection_id, None);
            Box::pin(async move {
                Ok(WorkflowRunEvent {
                    id: Uuid::new_v4(),
                    workflow_run_id: event.workflow_run_id,
                    workflow_id: event.workflow_id,
                    workspace_id: event.workspace_id,
                    triggered_by: event.triggered_by,
                    connection_type: event.connection_type,
                    connection_id: event.connection_id,
                    recorded_at: OffsetDateTime::now_utc(),
                })
            })
        });

        // Minimal interactions to complete the run successfully.
        repo.expect_renew_run_lease()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
        repo.expect_get_run_status()
            .returning(|_| Box::pin(async { Ok(None) }));
        let run_id = run.id;
        repo.expect_upsert_node_run().returning(
            move |_, node_id, name, node_type, inputs, outputs, status, error| {
                let node_id = node_id.to_owned();
                let name = name.map(|s| s.to_owned());
                let node_type = node_type.map(|s| s.to_owned());
                let inputs = inputs.clone();
                let outputs = outputs.clone();
                let status = status.to_owned();
                let error = error.map(|s| s.to_owned());
                Box::pin(async move {
                    Ok(WorkflowNodeRun {
                        id: Uuid::new_v4(),
                        run_id,
                        node_id,
                        name,
                        node_type,
                        inputs,
                        outputs,
                        status,
                        error,
                        started_at: OffsetDateTime::now_utc(),
                        finished_at: None,
                        created_at: OffsetDateTime::now_utc(),
                        updated_at: OffsetDateTime::now_utc(),
                    })
                })
            },
        );
        repo.expect_complete_workflow_run()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));

        let workflow_repo: Arc<dyn WorkflowRepository> = Arc::new(repo);
        let config = Arc::new(Config {
            database_url: String::new(),
            frontend_origin: "http://localhost".into(),
            admin_origin: "http://localhost".into(),
            oauth: OAuthSettings {
                google: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                microsoft: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                slack: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                asana: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                token_encryption_key: vec![0u8; 32],
            },
            api_secrets_encryption_key: vec![1u8; 32],
            stripe: StripeSettings {
                client_id: "stub".into(),
                secret_key: "stub".into(),
                webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            },
            auth_cookie_secure: true,
            webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            jwt_issuer: "test-issuer".into(),
            jwt_audience: "test-audience".into(),
            workspace_member_limit: DEFAULT_WORKSPACE_MEMBER_LIMIT,
            workspace_monthly_run_limit: DEFAULT_WORKSPACE_MONTHLY_RUN_LIMIT,
            runaway_limit_5min: RUNAWAY_LIMIT_5MIN,
        });

        let state = AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo,
            workspace_repo: Arc::new(NoopWorkspaceRepository),
            workspace_connection_repo: Arc::new(NoopWorkspaceConnectionRepository),
            stripe_event_log_repo: Arc::new(MockStripeEventLogRepository::default()),
            db_pool: test_pg_pool(),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts: OAuthAccountService::test_stub(),
            workspace_oauth: WorkspaceOAuthService::test_stub(),
            stripe: Arc::new(crate::services::stripe::MockStripeService::new()),
            http_client: Arc::new(Client::new()),
            config,
            worker_id: Arc::new("worker".into()),
            worker_lease_seconds: 30,
            jwt_keys: test_jwt_keys(),
        };

        // The worker loop should keep running without terminating; we assert it does not
        // return within the timeout window (i.e., stays alive).
        let result =
            tokio::time::timeout(std::time::Duration::from_millis(300), worker_loop(state)).await;
        assert!(
            result.is_err(),
            "worker should remain alive on safe persistence fallback"
        );
    }

    #[tokio::test]
    async fn trigger_schedule_records_connection_run_events() {
        let workspace_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let workflow_id = Uuid::new_v4();
        let workspace_connection = Uuid::new_v4();

        let workflow = Workflow {
            id: workflow_id,
            user_id,
            workspace_id: Some(workspace_id),
            name: "Scheduled".into(),
            description: None,
            data: json!({
                "nodes": [
                    {
                        "id": "schedule-1",
                        "type": "trigger",
                        "data": {
                            "label": "Schedule",
                            "triggerType": "schedule",
                            "scheduleConfig": {
                                "startDate": "2024-01-01",
                                "startTime": "00:00",
                                "timezone": "UTC"
                            }
                        }
                    },
                    {
                        "data": {
                            "connection": {
                                "connectionScope": "workspace",
                                "connectionId": workspace_connection
                            }
                        }
                    },
                    {
                        "data": {
                            "connection": {
                                "connectionScope": "user"
                            }
                        }
                    }
                ],
                "edges": []
            }),
            concurrency_limit: 1,
            egress_allowlist: vec![],
            require_hmac: false,
            hmac_replay_window_sec: 0,
            webhook_salt: Uuid::new_v4(),
            locked_by: None,
            locked_at: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        };

        let events: Arc<Mutex<Vec<_>>> = Arc::new(Mutex::new(Vec::new()));
        let runs: Arc<Mutex<Vec<WorkflowRun>>> = Arc::new(Mutex::new(Vec::new()));
        let marks: Arc<Mutex<Vec<Uuid>>> = Arc::new(Mutex::new(Vec::new()));

        let mut repo = MockWorkflowRepository::new();

        let workflow_clone = workflow.clone();
        repo.expect_find_workflow_by_id()
            .with(predicate::always(), predicate::eq(workflow_id))
            .returning(move |_, _| {
                let workflow = workflow_clone.clone();
                Box::pin(async move { Ok(Some(workflow)) })
            });
        repo.expect_count_workspace_runs_since()
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(0) }));

        let runs_clone = runs.clone();
        repo.expect_create_workflow_run().returning(
            move |user_id_param, workflow_id_param, workspace_id_param, snapshot, _| {
                let runs = runs_clone.clone();
                Box::pin(async move {
                    let run = WorkflowRun {
                        id: Uuid::new_v4(),
                        user_id: user_id_param,
                        workflow_id: workflow_id_param,
                        workspace_id: workspace_id_param,
                        snapshot,
                        status: "queued".into(),
                        error: None,
                        idempotency_key: None,
                        started_at: OffsetDateTime::now_utc(),
                        resume_at: OffsetDateTime::now_utc(),
                        finished_at: None,
                        created_at: OffsetDateTime::now_utc(),
                        updated_at: OffsetDateTime::now_utc(),
                    };
                    runs.lock().unwrap().push(run.clone());
                    Ok(crate::db::workflow_repository::CreateWorkflowRunOutcome {
                        run,
                        created: true,
                    })
                })
            },
        );

        let events_clone = events.clone();
        repo.expect_record_run_event().returning(move |event| {
            let events = events_clone.clone();
            Box::pin(async move {
                events.lock().unwrap().push(event.clone());
                Ok(WorkflowRunEvent {
                    id: Uuid::new_v4(),
                    workflow_run_id: event.workflow_run_id,
                    workflow_id: event.workflow_id,
                    workspace_id: event.workspace_id,
                    triggered_by: event.triggered_by,
                    connection_type: event.connection_type,
                    connection_id: event.connection_id,
                    recorded_at: OffsetDateTime::now_utc(),
                })
            })
        });

        let marks_clone = marks.clone();
        repo.expect_mark_schedule_run()
            .returning(move |schedule_id, _last_run, _next_run| {
                let marks = marks_clone.clone();
                Box::pin(async move {
                    marks.lock().unwrap().push(schedule_id);
                    Ok(())
                })
            });

        repo.expect_disable_workflow_schedule().times(0);

        let workflow_repo: Arc<dyn WorkflowRepository> = Arc::new(repo);

        let config = Arc::new(Config {
            database_url: String::new(),
            frontend_origin: "http://localhost".into(),
            admin_origin: "http://localhost".into(),
            oauth: OAuthSettings {
                google: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                microsoft: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                slack: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                asana: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                token_encryption_key: vec![0u8; 32],
            },
            api_secrets_encryption_key: vec![1u8; 32],
            stripe: StripeSettings {
                client_id: "stub".into(),
                secret_key: "stub".into(),
                webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            },
            auth_cookie_secure: true,
            webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            jwt_issuer: "test-issuer".into(),
            jwt_audience: "test-audience".into(),
            workspace_member_limit: DEFAULT_WORKSPACE_MEMBER_LIMIT,
            workspace_monthly_run_limit: DEFAULT_WORKSPACE_MONTHLY_RUN_LIMIT,
            runaway_limit_5min: RUNAWAY_LIMIT_5MIN,
        });

        let state = AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo,
            workspace_repo: Arc::new(NoopWorkspaceRepository),
            workspace_connection_repo: Arc::new(NoopWorkspaceConnectionRepository),
            stripe_event_log_repo: Arc::new(MockStripeEventLogRepository::default()),
            db_pool: test_pg_pool(),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts: OAuthAccountService::test_stub(),
            workspace_oauth: WorkspaceOAuthService::test_stub(),
            stripe: Arc::new(crate::services::stripe::MockStripeService::new()),
            http_client: Arc::new(Client::new()),
            config: Arc::clone(&config),
            worker_id: Arc::new("worker".into()),
            worker_lease_seconds: 30,
            jwt_keys: test_jwt_keys(),
        };

        let schedule = WorkflowSchedule {
            id: Uuid::new_v4(),
            workflow_id,
            user_id,
            config: json!({
                "startDate": "2024-01-01",
                "startTime": "00:00",
                "timezone": "UTC"
            }),
            next_run_at: Some(OffsetDateTime::now_utc() + TimeDuration::minutes(5)),
            last_run_at: None,
            enabled: true,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        };

        trigger_schedule(&state, schedule.clone())
            .await
            .expect("schedule triggers");

        let events = events.lock().unwrap().clone();
        assert_eq!(events.len(), 2);
        let mut workspace_event = None;
        let mut user_event = None;
        for event in events {
            if event.connection_type.as_deref() == Some("workspace") {
                workspace_event = Some(event);
            } else {
                user_event = Some(event);
            }
        }

        let workspace_event = workspace_event.expect("workspace event exists");
        assert_eq!(workspace_event.connection_id, Some(workspace_connection));
        assert_eq!(workspace_event.workflow_id, workflow_id);
        assert_eq!(workspace_event.workspace_id, Some(workspace_id));
        assert_eq!(
            workspace_event.triggered_by,
            format!("schedule:{}", schedule.id)
        );

        let user_event = user_event.expect("user event exists");
        assert_eq!(user_event.connection_type.as_deref(), Some("user"));
        assert!(user_event.connection_id.is_none());
        assert_eq!(user_event.workflow_run_id, workspace_event.workflow_run_id);

        let recorded_runs = runs.lock().unwrap();
        assert_eq!(recorded_runs.len(), 1);
        assert_eq!(recorded_runs[0].workflow_id, workflow_id);
        assert_eq!(
            recorded_runs[0]
                .snapshot
                .get("_start_from_node")
                .and_then(|v| v.as_str()),
            Some("schedule-1")
        );

        assert!(marks.lock().unwrap().contains(&schedule.id));
    }

    #[tokio::test]
    async fn scheduled_run_respects_runaway_protection_before_quota() {
        let workspace_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let workflow_id = Uuid::new_v4();

        let workflow = Workflow {
            id: workflow_id,
            user_id,
            workspace_id: Some(workspace_id),
            name: "schedule runaway guard".into(),
            description: None,
            data: json!({
                "nodes": [{"id": "trigger", "type": "trigger", "data": {"label": "Trigger"}}],
                "edges": []
            }),
            concurrency_limit: 1,
            egress_allowlist: vec![],
            require_hmac: false,
            hmac_replay_window_sec: 300,
            webhook_salt: Uuid::new_v4(),
            locked_by: None,
            locked_at: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        };

        let mut repo = MockWorkflowRepository::new();
        repo.expect_find_workflow_by_id()
            .returning(move |user, id| {
                assert_eq!(user, user_id);
                assert_eq!(id, workflow_id);
                let wf = workflow.clone();
                Box::pin(async move { Ok(Some(wf)) })
            });
        repo.expect_count_workspace_runs_since()
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(RUNAWAY_LIMIT_5MIN + 10) }));
        repo.expect_create_workflow_run().times(0);
        repo.expect_record_run_event().times(0);
        repo.expect_mark_schedule_run()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
        repo.expect_disable_workflow_schedule().times(0);

        let workflow_repo: Arc<dyn WorkflowRepository> = Arc::new(repo);
        let workspace_repo = StaticWorkspaceMembershipRepository::allowing();
        let config = Arc::new(Config {
            database_url: String::new(),
            frontend_origin: "http://localhost".into(),
            admin_origin: "http://localhost".into(),
            oauth: OAuthSettings {
                google: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                microsoft: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                slack: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                asana: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                token_encryption_key: vec![0u8; 32],
            },
            api_secrets_encryption_key: vec![1u8; 32],
            stripe: StripeSettings {
                client_id: "stub".into(),
                secret_key: "stub".into(),
                webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            },
            auth_cookie_secure: true,
            webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            jwt_issuer: "test-issuer".into(),
            jwt_audience: "test-audience".into(),
            workspace_member_limit: DEFAULT_WORKSPACE_MEMBER_LIMIT,
            workspace_monthly_run_limit: DEFAULT_WORKSPACE_MONTHLY_RUN_LIMIT,
            runaway_limit_5min: RUNAWAY_LIMIT_5MIN,
        });

        let state = AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo,
            workspace_repo: Arc::new(workspace_repo.clone()),
            workspace_connection_repo: Arc::new(NoopWorkspaceConnectionRepository),
            stripe_event_log_repo: Arc::new(MockStripeEventLogRepository::default()),
            db_pool: test_pg_pool(),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts: OAuthAccountService::test_stub(),
            workspace_oauth: WorkspaceOAuthService::test_stub(),
            stripe: Arc::new(crate::services::stripe::MockStripeService::new()),
            http_client: Arc::new(Client::new()),
            config,
            worker_id: Arc::new("worker".into()),
            worker_lease_seconds: 30,
            jwt_keys: test_jwt_keys(),
        };

        let schedule = WorkflowSchedule {
            id: Uuid::new_v4(),
            workflow_id,
            user_id,
            config: json!({
                "startDate": "2024-01-01",
                "startTime": "00:00",
                "timezone": "UTC"
            }),
            next_run_at: Some(OffsetDateTime::now_utc() + TimeDuration::minutes(5)),
            last_run_at: None,
            enabled: true,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        };

        trigger_schedule(&state, schedule)
            .await
            .expect("schedule processing should complete");

        assert!(
            workspace_repo.last_period_starts().is_empty(),
            "quota should not increment when runaway protection blocks the run"
        );
    }

    #[tokio::test]
    async fn worker_blocks_run_and_records_event_when_over_limit() {
        let workspace_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let workflow_id = Uuid::new_v4();
        let run = WorkflowRun {
            id: Uuid::new_v4(),
            user_id,
            workflow_id,
            workspace_id: Some(workspace_id),
            snapshot: json!({"nodes": [], "edges": []}),
            status: "running".into(),
            error: None,
            idempotency_key: None,
            started_at: OffsetDateTime::now_utc(),
            resume_at: OffsetDateTime::now_utc(),
            finished_at: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        };

        #[allow(clippy::type_complexity)]
        let completions: Arc<Mutex<Vec<(Uuid, String, Option<String>)>>> =
            Arc::new(Mutex::new(Vec::new()));
        let recorded_events: Arc<Mutex<Vec<NewWorkflowRunEvent>>> =
            Arc::new(Mutex::new(Vec::new()));

        let mut repo = MockWorkflowRepository::new();
        repo.expect_count_workspace_runs_since()
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(RUNAWAY_LIMIT_5MIN + 1) }));

        let events_clone = Arc::clone(&recorded_events);
        repo.expect_record_run_event().returning(move |event| {
            let events = Arc::clone(&events_clone);
            Box::pin(async move {
                events.lock().unwrap().push(event.clone());
                Ok(WorkflowRunEvent {
                    id: Uuid::new_v4(),
                    workflow_run_id: event.workflow_run_id,
                    workflow_id: event.workflow_id,
                    workspace_id: event.workspace_id,
                    triggered_by: event.triggered_by,
                    connection_type: event.connection_type.clone(),
                    connection_id: event.connection_id,
                    recorded_at: event.recorded_at.unwrap_or_else(OffsetDateTime::now_utc),
                })
            })
        });

        let completion_log = Arc::clone(&completions);
        repo.expect_complete_workflow_run()
            .times(1)
            .returning(move |run_id, status, error| {
                let log = Arc::clone(&completion_log);
                let status_owned = status.to_string();
                let error_owned = error.map(|e| e.to_string());
                Box::pin(async move {
                    log.lock()
                        .unwrap()
                        .push((run_id, status_owned, error_owned));
                    Ok(())
                })
            });

        let workflow_repo: Arc<dyn WorkflowRepository> = Arc::new(repo);
        let config = Arc::new(Config {
            database_url: String::new(),
            frontend_origin: "http://localhost".into(),
            admin_origin: "http://localhost".into(),
            oauth: OAuthSettings {
                google: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                microsoft: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                slack: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                asana: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                token_encryption_key: vec![0u8; 32],
            },
            api_secrets_encryption_key: vec![1u8; 32],
            stripe: StripeSettings {
                client_id: "stub".into(),
                secret_key: "stub".into(),
                webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            },
            auth_cookie_secure: true,
            webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            jwt_issuer: "test-issuer".into(),
            jwt_audience: "test-audience".into(),
            workspace_member_limit: DEFAULT_WORKSPACE_MEMBER_LIMIT,
            workspace_monthly_run_limit: DEFAULT_WORKSPACE_MONTHLY_RUN_LIMIT,
            runaway_limit_5min: 1,
        });

        let state = AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo,
            workspace_repo: Arc::new(NoopWorkspaceRepository),
            workspace_connection_repo: Arc::new(NoopWorkspaceConnectionRepository),
            stripe_event_log_repo: Arc::new(MockStripeEventLogRepository::default()),
            db_pool: test_pg_pool(),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts: OAuthAccountService::test_stub(),
            workspace_oauth: WorkspaceOAuthService::test_stub(),
            stripe: Arc::new(crate::services::stripe::MockStripeService::new()),
            http_client: Arc::new(Client::new()),
            config,
            worker_id: Arc::new("worker".into()),
            worker_lease_seconds: 30,
            jwt_keys: test_jwt_keys(),
        };

        let (_, result) = run_with_deadline(state, run, Duration::from_secs(5)).await;
        assert!(result.is_ok());

        let completions = completions.lock().unwrap();
        assert_eq!(completions.len(), 1);
        assert_eq!(completions[0].1, "failed");
        assert_eq!(completions[0].2.as_deref(), Some(RUNAWAY_PROTECTION_ERROR));

        let events = recorded_events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].connection_type.as_deref(),
            Some(RUNAWAY_PROTECTION_ERROR)
        );
        assert_eq!(events[0].workspace_id, Some(workspace_id));
    }
}
