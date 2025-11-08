use std::collections::HashSet;
use std::time::Duration;

use serde_json::{json, Map, Value};
use thiserror::Error;
use tokio::time::{sleep, timeout, Instant};
use tracing::{debug, error, warn};
use uuid::Uuid;

use crate::models::workflow_run::WorkflowRun;
use crate::models::workflow_run_event::NewWorkflowRunEvent;
use crate::state::AppState;
use crate::utils::workflow_connection_metadata;

use super::actions::{execute_action, execute_condition, execute_trigger};
use super::graph::Graph;

const PERSISTENCE_MAX_ATTEMPTS: usize = 3;
#[cfg(test)]
const PERSISTENCE_INITIAL_BACKOFF: Duration = Duration::from_millis(5);
#[cfg(not(test))]
const PERSISTENCE_INITIAL_BACKOFF: Duration = Duration::from_millis(100);

#[derive(Debug, Error)]
pub enum ExecutorError {
    #[error(
        "executor persistence operation `{operation}` failed for run {run_id} after {attempts} attempts: {source}"
    )]
    Persistence {
        run_id: Uuid,
        operation: &'static str,
        attempts: usize,
        #[source]
        source: sqlx::Error,
    },
}

impl ExecutorError {
    pub fn run_id(&self) -> Uuid {
        match self {
            ExecutorError::Persistence { run_id, .. } => *run_id,
        }
    }

    pub fn operation(&self) -> &'static str {
        match self {
            ExecutorError::Persistence { operation, .. } => operation,
        }
    }

    pub fn attempts(&self) -> usize {
        match self {
            ExecutorError::Persistence { attempts, .. } => *attempts,
        }
    }
}

pub async fn execute_run(state: AppState, run: WorkflowRun) -> Result<(), ExecutorError> {
    let triggered_by = format!("worker:{}", state.worker_id.as_ref());
    let metadata = workflow_connection_metadata::collect(&run.snapshot);
    let events = workflow_connection_metadata::build_run_events(&run, &triggered_by, &metadata);
    for event in events {
        let repo = state.workflow_repo.clone();
        retry_with_backoff(run.id, "record_run_event", || {
            let repo = repo.clone();
            let event = event.clone();
            async move { repo.record_run_event(event).await }
        })
        .await?;
    }

    let Some(graph) = Graph::from_snapshot(&run.snapshot) else {
        complete_run_with_retry(&state, run.id, "failed", Some("Invalid snapshot")).await?;
        return Ok(());
    };

    let mut context: Map<String, Value> = Map::new();
    if let Some(initial) = run.snapshot.get("_trigger_context") {
        let trigger_key = graph
            .nodes
            .values()
            .find(|n| n.kind == "trigger")
            .map(|n| context_keys(n).0);
        let key = trigger_key.unwrap_or_else(|| "trigger".to_string());
        context.insert(key, initial.clone());
    }

    let allowlist_env = std::env::var("ALLOWED_HTTP_DOMAINS")
        .ok()
        .unwrap_or_default();
    let env_allowed_hosts = parse_host_list(&allowlist_env);
    let snapshot_allowlist = collect_snapshot_allowlist(run.snapshot.get("_egress_allowlist"));
    let (allowed_hosts, rejected_allowlist) =
        merge_advisory_allowlist(&env_allowed_hosts, &snapshot_allowlist);

    if !rejected_allowlist.is_empty() {
        warn!(
            run_id = %run.id,
            workflow_id = %run.workflow_id,
            workspace_id = ?run.workspace_id,
            requested = ?snapshot_allowlist,
            rejected = ?rejected_allowlist,
            policy = if env_allowed_hosts.is_empty() {
                "none"
            } else {
                "env_allowlist"
            },
            "Snapshot egress allowlist entries rejected by policy"
        );

        let violation_event = NewWorkflowRunEvent {
            workflow_run_id: run.id,
            workflow_id: run.workflow_id,
            workspace_id: run.workspace_id,
            triggered_by: triggered_by.clone(),
            connection_type: Some("egress_policy_violation".to_string()),
            connection_id: None,
            recorded_at: None,
        };

        let repo = state.workflow_repo.clone();
        if let Err(err) = retry_with_backoff(run.id, "record_run_event", || {
            let repo = repo.clone();
            let event = violation_event.clone();
            async move { repo.record_run_event(event).await }
        })
        .await
        {
            warn!(
                run_id = %run.id,
                workflow_id = %run.workflow_id,
                ?err,
                "Failed to record egress policy violation run event"
            );
        }
    }

    let disallow_env = std::env::var("DISALLOWED_HTTP_DOMAINS")
        .ok()
        .unwrap_or_default();
    let mut disallowed_hosts: Vec<String> = parse_host_list(&disallow_env);

    let is_prod =
        std::env::var("ENV").ok().map(|v| v.to_lowercase()) == Some("production".to_string());
    if is_prod {
        disallowed_hosts.push("metadata.google.internal".to_string());
    }
    disallowed_hosts.sort();
    disallowed_hosts.dedup();

    let default_deny = std::env::var("EGRESS_DEFAULT_DENY")
        .ok()
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let mut visited: HashSet<String> = HashSet::new();
    let start_from = run
        .snapshot
        .get("_start_from_node")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut stack: Vec<String> = if let Some(start_id) = start_from {
        vec![start_id]
    } else {
        let mut s: Vec<String> = graph
            .nodes
            .values()
            .filter(|n| n.kind == "trigger")
            .map(|n| n.id.clone())
            .collect();
        if s.is_empty() {
            if let Some(first) = graph.nodes.keys().next() {
                s.push(first.clone());
            }
        }
        s
    };

    let cancellation_poll_interval = std::env::var("RUN_STATUS_POLL_INTERVAL_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .map(Duration::from_millis)
        .unwrap_or(Duration::from_millis(500));
    let cancellation_poll_timeout = std::env::var("RUN_STATUS_POLL_TIMEOUT_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .map(Duration::from_millis)
        .unwrap_or(Duration::from_millis(200));
    let lease_refresh_interval = std::env::var("RUN_LEASE_RENEWAL_INTERVAL_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .map(Duration::from_millis)
        .unwrap_or_else(|| {
            let lease_seconds = state.worker_lease_seconds.max(1) as u64;
            let half = lease_seconds / 2;
            if half == 0 {
                Duration::from_secs(1)
            } else {
                Duration::from_secs(half)
            }
        });

    let mut last_cancellation_check = Instant::now()
        .checked_sub(cancellation_poll_interval)
        .unwrap_or_else(Instant::now);
    let mut last_lease_refresh = Instant::now()
        .checked_sub(lease_refresh_interval)
        .unwrap_or_else(Instant::now);

    let mut canceled = false;
    while let Some(node_id) = stack.pop() {
        if last_lease_refresh.elapsed() >= lease_refresh_interval {
            match renew_run_lease_with_retry(
                &state,
                run.id,
                &state.worker_id,
                state.worker_lease_seconds,
            )
            .await
            {
                Ok(()) => {
                    last_lease_refresh = Instant::now();
                }
                Err(err) => {
                    warn!(
                        %run.id,
                        worker_id = %state.worker_id,
                        ?err,
                        "executor: failed to renew run lease, aborting run"
                    );
                    if let Err(cancel_err) = complete_run_with_retry(
                        &state,
                        run.id,
                        "canceled",
                        Some("Worker lost lease during execution"),
                    )
                    .await
                    {
                        warn!(
                            %run.id,
                            worker_id = %state.worker_id,
                            ?cancel_err,
                            "executor: failed to mark run canceled after lease renewal error"
                        );
                        return Err(cancel_err);
                    }
                    return Ok(());
                }
            }
        }

        if last_cancellation_check.elapsed() >= cancellation_poll_interval {
            match timeout(
                cancellation_poll_timeout,
                state.workflow_repo.get_run_status(run.id),
            )
            .await
            {
                Ok(Ok(Some(status))) if status == "canceled" => {
                    canceled = true;
                    break;
                }
                Ok(Ok(_)) => {
                    last_cancellation_check = Instant::now();
                }
                Ok(Err(err)) => {
                    warn!(
                        %run.id,
                        worker_id = %state.worker_id,
                        ?err,
                        "executor: failed to fetch run status for cancellation poll"
                    );
                    last_cancellation_check = Instant::now();
                }
                Err(_) => {
                    warn!(
                        %run.id,
                        worker_id = %state.worker_id,
                        poll_timeout_ms = cancellation_poll_timeout.as_millis() as u64,
                        "executor: cancellation status poll timed out"
                    );
                    last_cancellation_check = Instant::now();
                }
            }
        }
        if visited.contains(&node_id) {
            continue;
        }
        visited.insert(node_id.clone());

        let Some(node) = graph.nodes.get(&node_id) else {
            continue;
        };
        let kind = node.kind.as_str();
        let mut next_nodes: Vec<String> = vec![];

        let running = state
            .workflow_repo
            .upsert_node_run(
                run.id,
                &node.id,
                node.data
                    .get("label")
                    .and_then(|v| v.as_str())
                    .or(Some(kind))
                    .map(|s| s as &str),
                Some(kind),
                Some(node.data.clone()),
                None,
                "running",
                None,
            )
            .await
            .ok();

        let context_value = Value::Object(context.clone());
        let node_label = node
            .data
            .get("label")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        debug!(
            node_id = %node.id,
            node_kind = %node.kind,
            node_label,
            context = %context_value,
            "Executing workflow node"
        );

        let execution = match kind {
            "trigger" => execute_trigger(node, &context_value).await,
            "condition" => execute_condition(node, &context_value).await,
            k if k == "action" || k.starts_with("action") => {
                execute_action(
                    node,
                    &context_value,
                    &allowed_hosts,
                    &disallowed_hosts,
                    default_deny,
                    is_prod,
                    &state,
                    &run,
                )
                .await
            }
            _ => Ok((json!({"skipped": true}), None)),
        };

        match execution {
            Ok((outputs, selected_next)) => {
                if let Some(nr) = running {
                    let _ = state
                        .workflow_repo
                        .upsert_node_run(
                            run.id,
                            &node.id,
                            nr.name.as_deref(),
                            nr.node_type.as_deref(),
                            nr.inputs.clone(),
                            Some(outputs.clone()),
                            "succeeded",
                            None,
                        )
                        .await;
                }

                // Insert node outputs into the workflow context under both the
                // original-cased label and a lowercase alias (for backward
                // compatibility with existing templates that used lowercased
                // node names). Field/property casing remains respected.
                let (primary_key, alias_key) = context_keys(node);
                context.insert(primary_key, outputs.clone());
                if let Some(alias) = alias_key {
                    // If an alias exists and differs from the primary key, also insert it
                    context.insert(alias, outputs.clone());
                }

                match selected_next {
                    Some(next_id) => next_nodes.push(next_id),
                    None => {
                        if kind == "condition" {
                            let desired_handle = outputs
                                .get("result")
                                .and_then(|v| v.as_bool())
                                .map(|is_true| if is_true { "cond-true" } else { "cond-false" });

                            if let Some(handle) = desired_handle {
                                next_nodes.extend(
                                    graph
                                        .outgoing(&node_id)
                                        .iter()
                                        .filter(|edge| {
                                            edge.source_handle.as_deref() == Some(handle)
                                        })
                                        .map(|edge| edge.target.clone()),
                                );
                            } else {
                                next_nodes.extend(
                                    graph
                                        .outgoing(&node_id)
                                        .iter()
                                        .map(|edge| edge.target.clone()),
                                );
                            }
                        } else {
                            next_nodes.extend(
                                graph
                                    .outgoing(&node_id)
                                    .iter()
                                    .map(|edge| edge.target.clone()),
                            );
                        }
                    }
                }
            }
            Err(err_msg) => {
                if let Some(nr) = running {
                    let _ = state
                        .workflow_repo
                        .upsert_node_run(
                            run.id,
                            &node.id,
                            nr.name.as_deref(),
                            nr.node_type.as_deref(),
                            nr.inputs.clone(),
                            None,
                            "failed",
                            Some(&err_msg),
                        )
                        .await;
                }

                let stop_on_error = node
                    .data
                    .get("stopOnError")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if stop_on_error || kind != "action" {
                    if let Err(err) = insert_dead_letter_with_retry(&state, &run, &err_msg).await {
                        // Attempt to still mark the run failed before bubbling up the error.
                        let _ =
                            complete_run_with_retry(&state, run.id, "failed", Some(&err_msg)).await;
                        return Err(err);
                    }
                    complete_run_with_retry(&state, run.id, "failed", Some(&err_msg)).await?;
                    return Ok(());
                } else {
                    next_nodes.extend(
                        graph
                            .outgoing(&node_id)
                            .iter()
                            .map(|edge| edge.target.clone()),
                    );
                }
            }
        }

        for next in next_nodes.into_iter().rev() {
            stack.push(next);
        }
    }

    if canceled {
        complete_run_with_retry(&state, run.id, "canceled", None).await?;
    } else {
        complete_run_with_retry(&state, run.id, "succeeded", None).await?;
    }

    Ok(())
}

fn context_keys(node: &super::graph::Node) -> (String, Option<String>) {
    // Prefer the node label if present; preserve its original casing.
    // Also provide a lowercase alias to maintain compatibility with
    // previously-generated templates that referenced lowercased node names.
    let label_opt = node
        .data
        .get("label")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    if let Some(label) = label_opt {
        let primary = label.to_string();
        let lower = label.to_lowercase();
        if lower != label {
            (primary, Some(lower))
        } else {
            (primary, None)
        }
    } else {
        (node.id.clone(), None)
    }
}

async fn retry_with_backoff<T, Fut, F>(
    run_id: Uuid,
    operation: &'static str,
    mut op: F,
) -> Result<T, ExecutorError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, sqlx::Error>>,
{
    let mut attempt = 0usize;
    let mut backoff = PERSISTENCE_INITIAL_BACKOFF;

    loop {
        attempt += 1;
        match op().await {
            Ok(value) => return Ok(value),
            Err(err) if attempt < PERSISTENCE_MAX_ATTEMPTS => {
                warn!(
                    %run_id,
                    operation,
                    attempt,
                    ?err,
                    "executor persistence operation failed; retrying"
                );
                sleep(backoff).await;
                backoff = backoff.saturating_mul(2);
            }
            Err(err) => {
                error!(
                    %run_id,
                    operation,
                    attempt,
                    ?err,
                    "executor persistence operation exhausted retries"
                );
                return Err(ExecutorError::Persistence {
                    run_id,
                    operation,
                    attempts: attempt,
                    source: err,
                });
            }
        }
    }
}

fn parse_host_list(raw: &str) -> Vec<String> {
    let mut hosts: Vec<String> = raw
        .split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    hosts.sort();
    hosts.dedup();
    hosts
}

fn collect_snapshot_allowlist(value: Option<&Value>) -> Vec<String> {
    let mut hosts: Vec<String> = Vec::new();
    if let Some(arr) = value.and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(s) = item.as_str() {
                let trimmed = s.trim().to_lowercase();
                if !trimmed.is_empty() {
                    hosts.push(trimmed);
                }
            }
        }
    }
    hosts.sort();
    hosts.dedup();
    hosts
}

fn merge_advisory_allowlist(
    env_hosts: &[String],
    snapshot_hosts: &[String],
) -> (Vec<String>, Vec<String>) {
    let mut allowed: HashSet<String> = env_hosts.iter().cloned().collect();
    let mut rejected: Vec<String> = Vec::new();

    if env_hosts.is_empty() {
        allowed.extend(snapshot_hosts.iter().cloned());
    } else {
        let env_set: HashSet<&str> = env_hosts.iter().map(|s| s.as_str()).collect();
        for host in snapshot_hosts {
            if env_set.contains(host.as_str()) {
                allowed.insert(host.clone());
            } else {
                rejected.push(host.clone());
            }
        }
    }

    let mut allowed_vec: Vec<String> = allowed.into_iter().collect();
    allowed_vec.sort();
    (allowed_vec, rejected)
}

async fn insert_dead_letter_with_retry(
    state: &AppState,
    run: &WorkflowRun,
    error: &str,
) -> Result<(), ExecutorError> {
    let repo = state.workflow_repo.clone();
    let snapshot = run.snapshot.clone();
    let error = error.to_string();

    retry_with_backoff(run.id, "insert_dead_letter", move || {
        let repo = repo.clone();
        let snapshot = snapshot.clone();
        let error = error.clone();
        async move {
            repo.insert_dead_letter(
                run.user_id,
                run.workflow_id,
                run.id,
                &error,
                snapshot.clone(),
            )
            .await
        }
    })
    .await
}

async fn renew_run_lease_with_retry(
    state: &AppState,
    run_id: Uuid,
    worker_id: &str,
    lease_seconds: i32,
) -> Result<(), ExecutorError> {
    let repo = state.workflow_repo.clone();
    let worker_id = worker_id.to_string();

    retry_with_backoff(run_id, "renew_run_lease", move || {
        let repo = repo.clone();
        let worker_id = worker_id.clone();
        async move {
            repo.renew_run_lease(run_id, &worker_id, lease_seconds)
                .await
        }
    })
    .await
}

pub(crate) async fn complete_run_with_retry(
    state: &AppState,
    run_id: Uuid,
    status: &str,
    error: Option<&str>,
) -> Result<(), ExecutorError> {
    let repo = state.workflow_repo.clone();
    let status = status.to_string();
    let error = error.map(|e| e.to_string());

    retry_with_backoff(run_id, "complete_workflow_run", move || {
        let repo = repo.clone();
        let status = status.clone();
        let error = error.clone();
        async move {
            repo.complete_workflow_run(run_id, &status, error.as_deref())
                .await
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, OAuthProviderConfig, OAuthSettings, StripeSettings};
    use crate::db::mock_db::{MockDb, NoopWorkspaceRepository};
    use crate::db::workflow_repository::{MockWorkflowRepository, WorkflowRepository};
    use crate::db::workspace_connection_repository::NoopWorkspaceConnectionRepository;
    use crate::models::workflow_run::WorkflowRun;
    use crate::models::workflow_run_event::WorkflowRunEvent;
    use crate::services::oauth::account_service::OAuthAccountService;
    use crate::services::oauth::github::mock_github_oauth::MockGitHubOAuth;
    use crate::services::oauth::google::mock_google_oauth::MockGoogleOAuth;
    use crate::services::oauth::workspace_service::WorkspaceOAuthService;
    use crate::services::smtp_mailer::MockMailer;
    use crate::services::stripe::MockStripeService;
    use crate::state::{test_pg_pool, AppState};
    use crate::utils::jwt::JwtKeys;
    use reqwest::Client;
    use serde_json::json;
    use std::sync::Arc;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn test_jwt_keys() -> Arc<JwtKeys> {
        Arc::new(
            JwtKeys::from_secret("0123456789abcdef0123456789abcdef")
                .expect("test JWT secret should be valid"),
        )
    }

    fn build_state(repo: MockWorkflowRepository) -> AppState {
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
                slack: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                token_encryption_key: vec![0u8; 32],
            },
            stripe: StripeSettings {
                client_id: "stub".into(),
                secret_key: "stub".into(),
                webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            },
            auth_cookie_secure: true,
            webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            jwt_issuer: "test-issuer".into(),
            jwt_audience: "test-audience".into(),
        });

        let workflow_repo: Arc<dyn WorkflowRepository> = Arc::new(repo);

        AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo,
            workspace_repo: Arc::new(NoopWorkspaceRepository),
            workspace_connection_repo: Arc::new(NoopWorkspaceConnectionRepository),
            db_pool: test_pg_pool(),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts: OAuthAccountService::test_stub(),
            workspace_oauth: WorkspaceOAuthService::test_stub(),
            stripe: Arc::new(MockStripeService::new()),
            http_client: Arc::new(Client::new()),
            config,
            worker_id: Arc::new("worker-test".into()),
            worker_lease_seconds: 30,
            jwt_keys: test_jwt_keys(),
        }
    }

    #[test]
    fn merge_allowlist_intersects_with_env_policy() {
        let env_hosts = vec!["api.example.com".to_string(), "*.trusted.dev".to_string()];
        let snapshot_hosts = vec![
            "api.example.com".to_string(),
            "api.example.com".to_string(),
            "malicious.example.com".to_string(),
            "*.trusted.dev".to_string(),
        ];

        let (allowed, rejected) = merge_advisory_allowlist(&env_hosts, &snapshot_hosts);

        assert_eq!(allowed, vec!["*.trusted.dev", "api.example.com"]);
        assert_eq!(rejected, vec!["malicious.example.com"]);
    }

    #[test]
    fn merge_allowlist_allows_snapshot_when_no_env_policy() {
        let env_hosts: Vec<String> = Vec::new();
        let snapshot_hosts = vec!["example.com".to_string(), "api.example.com".to_string()];

        let (allowed, rejected) = merge_advisory_allowlist(&env_hosts, &snapshot_hosts);

        assert_eq!(allowed, vec!["api.example.com", "example.com"]);
        assert!(rejected.is_empty());
    }

    #[test]
    fn collect_snapshot_allowlist_dedupes_and_normalizes() {
        let snapshot = json!(["Example.com", " example.com ", 1, null, "api.example.com"]);

        let hosts = collect_snapshot_allowlist(Some(&snapshot));

        assert_eq!(hosts, vec!["api.example.com", "example.com"]);
    }

    fn base_run(node_type: &str, data: serde_json::Value) -> WorkflowRun {
        let now = OffsetDateTime::now_utc();
        WorkflowRun {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            workflow_id: Uuid::new_v4(),
            workspace_id: Some(Uuid::new_v4()),
            snapshot: json!({
                "nodes": [
                    {
                        "id": "node-1",
                        "type": node_type,
                        "data": data,
                    }
                ],
                "edges": []
            }),
            status: "running".into(),
            error: None,
            idempotency_key: None,
            started_at: now,
            finished_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn dummy_node_run(
        run_id: Uuid,
        status: &str,
    ) -> crate::models::workflow_node_run::WorkflowNodeRun {
        let now = OffsetDateTime::now_utc();
        crate::models::workflow_node_run::WorkflowNodeRun {
            id: Uuid::new_v4(),
            run_id,
            node_id: "node-1".into(),
            name: Some("node".into()),
            node_type: Some("trigger".into()),
            inputs: None,
            outputs: None,
            status: status.into(),
            error: None,
            started_at: now,
            finished_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn record_run_event_failure_bubbles() {
        let run = base_run("trigger", json!({"label": "Trigger"}));

        let mut repo = MockWorkflowRepository::new();
        repo.expect_record_run_event()
            .times(PERSISTENCE_MAX_ATTEMPTS)
            .returning(|_event| Box::pin(async { Err(sqlx::Error::RowNotFound) }));

        let state = build_state(repo);

        let err = execute_run(state, run)
            .await
            .expect_err("should bubble error");
        assert_eq!(err.operation(), "record_run_event");
        assert_eq!(err.attempts(), PERSISTENCE_MAX_ATTEMPTS);
    }

    #[tokio::test]
    async fn complete_workflow_run_failure_bubbles() {
        let run = base_run("trigger", json!({"label": "Trigger"}));

        let mut repo = MockWorkflowRepository::new();
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
                    recorded_at: OffsetDateTime::now_utc(),
                })
            })
        });
        repo.expect_renew_run_lease()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
        repo.expect_get_run_status()
            .returning(|_| Box::pin(async { Ok(None) }));
        let run_id = run.id;
        repo.expect_upsert_node_run()
            .returning(move |_, _, _, _, _, _, _, _| {
                let node_run = dummy_node_run(run_id, "running");
                Box::pin(async move { Ok(node_run) })
            });
        repo.expect_complete_workflow_run()
            .times(PERSISTENCE_MAX_ATTEMPTS)
            .returning(|_, _, _| Box::pin(async { Err(sqlx::Error::RowNotFound) }));

        let state = build_state(repo);

        let err = execute_run(state, run)
            .await
            .expect_err("should bubble error");
        assert_eq!(err.operation(), "complete_workflow_run");
        assert_eq!(err.attempts(), PERSISTENCE_MAX_ATTEMPTS);
    }

    #[tokio::test]
    async fn insert_dead_letter_failure_bubbles() {
        let run = base_run("condition", json!({"label": "Condition"}));

        let mut repo = MockWorkflowRepository::new();
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
                    recorded_at: OffsetDateTime::now_utc(),
                })
            })
        });
        repo.expect_renew_run_lease()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
        repo.expect_get_run_status()
            .returning(|_| Box::pin(async { Ok(None) }));
        let run_id = run.id;
        repo.expect_upsert_node_run()
            .returning(move |_, _, _, _, _, _, _, _| {
                let node_run = dummy_node_run(run_id, "running");
                Box::pin(async move { Ok(node_run) })
            });
        repo.expect_insert_dead_letter()
            .times(PERSISTENCE_MAX_ATTEMPTS)
            .returning(|_, _, _, _, _| Box::pin(async { Err(sqlx::Error::RowNotFound) }));
        repo.expect_complete_workflow_run()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));

        let state = build_state(repo);

        let err = execute_run(state, run)
            .await
            .expect_err("should bubble error");
        assert_eq!(err.operation(), "insert_dead_letter");
        assert_eq!(err.attempts(), PERSISTENCE_MAX_ATTEMPTS);
    }

    #[tokio::test]
    async fn success_path_still_completes() {
        let run = base_run("trigger", json!({"label": "Trigger"}));

        let mut repo = MockWorkflowRepository::new();
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
                    recorded_at: OffsetDateTime::now_utc(),
                })
            })
        });
        repo.expect_renew_run_lease()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
        repo.expect_get_run_status()
            .returning(|_| Box::pin(async { Ok(None) }));
        let run_id = run.id;
        repo.expect_upsert_node_run()
            .returning(move |_, _, _, _, _, _, _, _| {
                let node_run = dummy_node_run(run_id, "running");
                Box::pin(async move { Ok(node_run) })
            });
        repo.expect_complete_workflow_run()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));

        let state = build_state(repo);

        execute_run(state, run)
            .await
            .expect("success path should still complete");
    }
}
