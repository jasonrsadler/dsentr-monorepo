use std::time::Duration;

use crate::engine::execute_run;
use crate::models::workflow_schedule::WorkflowSchedule;
use crate::state::AppState;
use crate::utils::schedule::{
    compute_next_run, offset_to_utc, parse_schedule_config, utc_to_offset,
};
use crate::utils::workflow_connection_metadata;
use chrono::Utc;
use serde_json::{json, Value};
use tokio::time::sleep;

pub async fn start_background_workers(state: AppState) {
    // Simple single-worker for now. Can be extended to multiple tasks.
    tokio::spawn(async move {
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
        loop {
            if last_schedule_check.elapsed() > Duration::from_secs(5) {
                if let Err(err) = process_due_schedules(&state).await {
                    eprintln!("worker: error processing schedules: {:?}", err);
                }
                last_schedule_check = std::time::Instant::now();
            }
            if use_leases {
                // Requeue any expired leases before claiming
                let _ = state.workflow_repo.requeue_expired_leases().await;
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
                    execute_run(state.clone(), run).await;
                }
                Ok(None) => {
                    sleep(Duration::from_millis(750)).await;
                }
                Err(e) => {
                    eprintln!("worker: error claiming run: {:?}", e);
                    sleep(Duration::from_millis(1000)).await;
                }
            }

            // Do cleanup once in a while (every ~10 minutes)
            if last_cleanup.elapsed() > Duration::from_secs(600) {
                let _ = state.workflow_repo.purge_old_runs(retention_days).await;
                last_cleanup = std::time::Instant::now();
            }
        }
    });
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
            eprintln!(
                "worker: failed to trigger schedule {}: {:?}",
                schedule_id, err
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

    let connection_metadata = workflow_connection_metadata::collect(&snapshot);
    workflow_connection_metadata::embed(&mut snapshot, &connection_metadata);

    let run = state
        .workflow_repo
        .create_workflow_run(
            schedule.user_id,
            schedule.workflow_id,
            workflow.workspace_id,
            snapshot,
            None,
        )
        .await?;

    let triggered_by = format!("schedule:{}", schedule.id);
    let events =
        workflow_connection_metadata::build_run_events(&run, &triggered_by, &connection_metadata);
    for event in events {
        state.workflow_repo.record_run_event(event).await?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, OAuthProviderConfig, OAuthSettings};
    use crate::db::mock_db::{MockDb, NoopWorkspaceRepository};
    use crate::db::workflow_repository::{MockWorkflowRepository, WorkflowRepository};
    use crate::db::workspace_connection_repository::NoopWorkspaceConnectionRepository;
    use crate::models::workflow::Workflow;
    use crate::models::workflow_run::WorkflowRun;
    use crate::models::workflow_run_event::WorkflowRunEvent;
    use crate::models::workflow_schedule::WorkflowSchedule;
    use crate::services::oauth::account_service::OAuthAccountService;
    use crate::services::oauth::github::mock_github_oauth::MockGitHubOAuth;
    use crate::services::oauth::google::mock_google_oauth::MockGoogleOAuth;
    use crate::services::oauth::workspace_service::WorkspaceOAuthService;
    use crate::services::smtp_mailer::MockMailer;
    use crate::state::AppState;
    use mockall::predicate;
    use reqwest::Client;
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use time::{Duration as TimeDuration, OffsetDateTime};
    use uuid::Uuid;

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
                ]
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
                        finished_at: None,
                        created_at: OffsetDateTime::now_utc(),
                        updated_at: OffsetDateTime::now_utc(),
                    };
                    runs.lock().unwrap().push(run.clone());
                    Ok(run)
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
                token_encryption_key: vec![0u8; 32],
            },
        });

        let state = AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo,
            workspace_repo: Arc::new(NoopWorkspaceRepository),
            workspace_connection_repo: Arc::new(NoopWorkspaceConnectionRepository),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts: OAuthAccountService::test_stub(),
            workspace_oauth: WorkspaceOAuthService::test_stub(),
            http_client: Arc::new(Client::new()),
            config: Arc::clone(&config),
            worker_id: Arc::new("worker".into()),
            worker_lease_seconds: 30,
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

        assert!(marks.lock().unwrap().contains(&schedule.id));
    }
}
