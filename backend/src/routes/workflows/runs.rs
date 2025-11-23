use super::{
    helpers::{enforce_solo_workflow_limit, plan_violation_response, SOLO_MONTHLY_RUN_LIMIT},
    prelude::*,
};
use crate::{
    routes::{options::secrets::decrypt_secret_store, plan_limits::workspace_limit_error_response},
    state::WorkspaceRunQuotaTicket,
    utils::{secrets::hydrate_secrets_into_snapshot, workflow_connection_metadata},
};

async fn fetch_workflow_for_member(
    app_state: &AppState,
    actor_id: Uuid,
    workflow_id: Uuid,
    server_error_message: &'static str,
) -> Result<Workflow, Response> {
    match app_state
        .workflow_repo
        .find_workflow_for_member(actor_id, workflow_id)
        .await
    {
        Ok(Some(workflow)) => Ok(workflow),
        Ok(None) => Err(JsonResponse::not_found("Workflow not found").into_response()),
        Err(err) => {
            eprintln!(
                "DB error fetching workflow {workflow_id} for user {actor_id}: {:?}",
                err
            );
            Err(JsonResponse::server_error(server_error_message).into_response())
        }
    }
}

#[derive(Deserialize)]
pub struct StartWorkflowRunRequest {
    pub idempotency_key: Option<String>,
    pub context: Option<serde_json::Value>,
    pub priority: Option<i32>,
}

fn redact_secrets(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (k, v) in map.iter_mut() {
                let key = k.to_lowercase();
                if key.contains("secret")
                    || key.contains("token")
                    || key.contains("apikey")
                    || key.contains("api_key")
                    || key.contains("authorization")
                {
                    *v = serde_json::Value::String("********".to_string());
                } else {
                    redact_secrets(v);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr.iter_mut() {
                redact_secrets(v);
            }
        }
        _ => {}
    }
}

pub async fn start_workflow_run(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    payload: Option<Json<StartWorkflowRunRequest>>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let triggered_by = claims.id.clone();

    let wf =
        match fetch_workflow_for_member(&app_state, user_id, workflow_id, "Failed to start run")
            .await
        {
            Ok(workflow) => workflow,
            Err(response) => return response,
        };

    let owner_id = wf.user_id;

    let mut workspace_quota: Option<WorkspaceRunQuotaTicket> = None;
    let plan_tier = if let Some(workspace_id) = wf.workspace_id {
        match app_state.consume_workspace_run_quota(workspace_id).await {
            Ok(ticket) => workspace_quota = Some(ticket),
            Err(err) => return workspace_limit_error_response(err),
        }
        NormalizedPlanTier::Workspace
    } else {
        app_state
            .resolve_plan_tier(user_id, claims.plan.as_deref())
            .await
    };

    if plan_tier.is_solo() {
        if wf.workspace_id.is_none() && wf.user_id == user_id {
            match app_state
                .workflow_repo
                .list_workflows_by_user(owner_id)
                .await
            {
                Ok(existing) => {
                    let allowed = enforce_solo_workflow_limit(&existing);
                    let allowed_ids: HashSet<_> = allowed.into_iter().map(|wf| wf.id).collect();
                    if !allowed_ids.contains(&wf.id) {
                        let violation = PlanViolation {
                            code: "workflow-limit",
                            message: "This workflow is locked on the solo plan. Upgrade in Settings → Plan to run it.".to_string(),
                            node_label: None,
                        };
                        return plan_violation_response(vec![violation]);
                    }
                }
                Err(err) => {
                    eprintln!("Failed to enforce workflow limit before run: {:?}", err);
                    return JsonResponse::server_error("Failed to start run").into_response();
                }
            }

            let assessment = assess_workflow_for_plan(&wf.data);
            if !assessment.violations.is_empty() {
                return plan_violation_response(assessment.violations);
            }
        }

        let now = OffsetDateTime::now_utc();
        let start_of_month = now
            .replace_day(1)
            .unwrap_or(now)
            .replace_time(Time::MIDNIGHT);

        match app_state
            .workflow_repo
            .count_user_runs_since(owner_id, start_of_month)
            .await
        {
            Ok(count) if count >= SOLO_MONTHLY_RUN_LIMIT => {
                let violation = PlanViolation {
                    code: "run-limit",
                    message: "Solo plan usage includes 250 runs per month. You've reached the limit—upgrade in Settings → Plan to keep running workflows.".to_string(),
                    node_label: None,
                };
                return plan_violation_response(vec![violation]);
            }
            Ok(_) => {}
            Err(err) => {
                eprintln!("Failed to check monthly usage: {:?}", err);
                return JsonResponse::server_error("Failed to start run").into_response();
            }
        }
    }

    let (idempotency_key_owned, trigger_ctx, priority) = match payload {
        Some(Json(req)) => (req.idempotency_key, req.context, req.priority),
        None => (None, None, None),
    };
    let idempotency_key = idempotency_key_owned.as_deref();

    // Clone raw workflow JSON
    let mut snapshot = wf.data.clone();

    if let Some(ctx) = trigger_ctx {
        snapshot["_trigger_context"] = ctx;
    }

    // ---- SECRET HYDRATION FIX ----

    let settings = match app_state.db.get_user_settings(owner_id).await {
        Ok(val) => val,
        Err(err) => {
            eprintln!("Failed to load user settings: {:?}", err);
            return JsonResponse::server_error("Failed to load secrets").into_response();
        }
    };

    let (secret_store, _) = match decrypt_secret_store(
        &app_state,
        &settings,
        "Failed to decrypt user secrets while starting run",
        "Failed to start run",
    ) {
        Ok(tuple) => tuple,
        Err(resp) => return resp,
    };

    // Put plaintext secrets directly into the snapshot
    hydrate_secrets_into_snapshot(&mut snapshot, &secret_store);

    // --------------------------------------

    snapshot["_egress_allowlist"] = serde_json::Value::Array(
        wf.egress_allowlist
            .iter()
            .cloned()
            .map(serde_json::Value::String)
            .collect(),
    );

    if let Some(obj) = snapshot.as_object_mut() {
        obj.remove("_connection_metadata");
    }

    let connection_metadata = workflow_connection_metadata::collect(&snapshot);
    workflow_connection_metadata::embed(&mut snapshot, &connection_metadata);

    match app_state
        .workflow_repo
        .create_workflow_run(
            owner_id,
            workflow_id,
            wf.workspace_id,
            snapshot,
            idempotency_key,
        )
        .await
    {
        Ok(outcome) => {
            if let (Some(ticket), false) = (&workspace_quota, outcome.created) {
                let _ = app_state.release_workspace_run_quota(*ticket).await;
            }

            let run = outcome.run;

            if let Some(p) = priority {
                let _ = app_state
                    .workflow_repo
                    .set_run_priority(owner_id, workflow_id, run.id, p)
                    .await;
            }

            for event in workflow_connection_metadata::build_run_events(
                &run,
                &triggered_by,
                &connection_metadata,
            ) {
                if let Err(err) = app_state.workflow_repo.record_run_event(event).await {
                    eprintln!("Failed to record workflow run event {}: {:?}", run.id, err);
                }
            }

            let mut safe_run = run.clone();
            let mut safe_snapshot = safe_run.snapshot.clone();
            redact_secrets(&mut safe_snapshot);
            safe_run.snapshot = safe_snapshot;

            (
                StatusCode::ACCEPTED,
                Json(json!({
                    "success": true,
                    "run": safe_run
                })),
            )
                .into_response()
        }
        Err(e) => {
            if let Some(ticket) = workspace_quota {
                let _ = app_state.release_workspace_run_quota(ticket).await;
            }
            eprintln!("DB error creating workflow run: {:?}", e);
            JsonResponse::server_error("Failed to enqueue run").into_response()
        }
    }
}

pub async fn get_workflow_run_status(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((workflow_id, run_id)): Path<(Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let workflow =
        match fetch_workflow_for_member(&app_state, user_id, workflow_id, "Failed to fetch run")
            .await
        {
            Ok(workflow) => workflow,
            Err(response) => return response,
        };
    let owner_id = workflow.user_id;

    match app_state
        .workflow_repo
        .get_workflow_run(owner_id, workflow_id, run_id)
        .await
    {
        Ok(Some(run)) => {
            let nodes_res = app_state
                .workflow_repo
                .list_workflow_node_runs(owner_id, workflow_id, run_id)
                .await;
            match nodes_res {
                Ok(node_runs) => (
                    StatusCode::OK,
                    Json(json!({
                        "success": true,
                        "run": run,
                        "node_runs": node_runs
                    })),
                )
                    .into_response(),
                Err(e) => {
                    eprintln!("DB error listing node runs: {:?}", e);
                    JsonResponse::server_error("Failed to fetch run status").into_response()
                }
            }
        }
        Ok(None) => JsonResponse::not_found("Run not found").into_response(),
        Err(e) => {
            eprintln!("DB error fetching run: {:?}", e);
            JsonResponse::server_error("Failed to fetch run").into_response()
        }
    }
}

pub async fn cancel_workflow_run(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((workflow_id, run_id)): Path<(Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let workflow =
        match fetch_workflow_for_member(&app_state, user_id, workflow_id, "Failed to cancel run")
            .await
        {
            Ok(workflow) => workflow,
            Err(response) => return response,
        };
    let owner_id = workflow.user_id;

    match app_state
        .workflow_repo
        .cancel_workflow_run(owner_id, workflow_id, run_id)
        .await
    {
        Ok(true) => (
            StatusCode::OK,
            Json(json!({"success": true, "status": "canceled" })),
        )
            .into_response(),
        Ok(false) => {
            JsonResponse::bad_request("Run is not cancelable or not found").into_response()
        }
        Err(e) => {
            eprintln!("DB error canceling run: {:?}", e);
            JsonResponse::server_error("Failed to cancel run").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct ListRunsQuery {
    pub workflow_id: Option<Uuid>,
}

pub async fn list_active_runs(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Query(params): Query<ListRunsQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let (owner_id, workflow_scope) = if let Some(workflow_id) = params.workflow_id {
        match fetch_workflow_for_member(&app_state, user_id, workflow_id, "Failed to list runs")
            .await
        {
            Ok(workflow) => (workflow.user_id, Some(workflow_id)),
            Err(response) => return response,
        }
    } else {
        (user_id, None)
    };

    match app_state
        .workflow_repo
        .list_active_runs(owner_id, workflow_scope)
        .await
    {
        Ok(runs) => (
            StatusCode::OK,
            Json(json!({ "success": true, "runs": runs })),
        )
            .into_response(),
        Err(e) => {
            eprintln!("DB error listing active runs: {:?}", e);
            JsonResponse::server_error("Failed to list runs").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct PagedRunsQuery {
    pub status: Option<Vec<String>>, // e.g., status=running&status=queued
    pub page: Option<i64>,           // 1-based
    pub per_page: Option<i64>,       // default 20
}

pub async fn list_runs_for_workflow(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Query(params): Query<PagedRunsQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let per_page = params.per_page.unwrap_or(20).clamp(1, 100);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * per_page;

    let workflow =
        match fetch_workflow_for_member(&app_state, user_id, workflow_id, "Failed to list runs")
            .await
        {
            Ok(workflow) => workflow,
            Err(response) => return response,
        };

    match app_state
        .workflow_repo
        .list_runs_paged(
            workflow.user_id,
            Some(workflow_id),
            params.status.as_deref(),
            per_page,
            offset,
        )
        .await
    {
        Ok(runs) => (
            StatusCode::OK,
            Json(json!({ "success": true, "runs": runs, "page": page, "per_page": per_page })),
        )
            .into_response(),
        Err(e) => {
            eprintln!("DB error listing runs: {:?}", e);
            JsonResponse::server_error("Failed to list runs").into_response()
        }
    }
}

pub async fn cancel_all_runs_for_workflow(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let workflow =
        match fetch_workflow_for_member(&app_state, user_id, workflow_id, "Failed to cancel runs")
            .await
        {
            Ok(workflow) => workflow,
            Err(response) => return response,
        };

    match app_state
        .workflow_repo
        .cancel_all_runs_for_workflow(workflow.user_id, workflow_id)
        .await
    {
        Ok(affected) => (
            StatusCode::OK,
            Json(json!({"success": true, "canceled": affected })),
        )
            .into_response(),
        Err(e) => {
            eprintln!("DB error canceling runs: {:?}", e);
            JsonResponse::server_error("Failed to cancel runs").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct RerunRequest {
    pub idempotency_key: Option<String>,
    pub context: Option<serde_json::Value>,
    pub start_from_node_id: Option<String>,
}

pub async fn rerun_workflow_run(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((workflow_id, run_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<RerunRequest>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let triggered_by = claims.id.clone();

    // Fetch the original run to get snapshot
    let workflow = match fetch_workflow_for_member(
        &app_state,
        user_id,
        workflow_id,
        "Failed to rerun",
    )
    .await
    {
        Ok(workflow) => workflow,
        Err(response) => return response,
    };

    let base_run = match app_state
        .workflow_repo
        .get_workflow_run(workflow.user_id, workflow_id, run_id)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => return JsonResponse::not_found("Run not found").into_response(),
        Err(e) => {
            eprintln!("DB error fetching run for rerun: {:?}", e);
            return JsonResponse::server_error("Failed to rerun").into_response();
        }
    };

    let mut snapshot = base_run.snapshot.clone();
    if let Some(ctx) = payload.context {
        snapshot["_trigger_context"] = ctx;
    }
    if let Some(start_id) = payload.start_from_node_id {
        snapshot["_start_from_node"] = serde_json::Value::String(start_id);
    }

    if let Some(obj) = snapshot.as_object_mut() {
        obj.remove("_connection_metadata");
    }
    let connection_metadata = workflow_connection_metadata::collect(&snapshot);
    workflow_connection_metadata::embed(&mut snapshot, &connection_metadata);

    let mut workspace_quota: Option<WorkspaceRunQuotaTicket> = None;
    if let Some(workspace_id) = workflow.workspace_id {
        match app_state.consume_workspace_run_quota(workspace_id).await {
            Ok(ticket) => workspace_quota = Some(ticket),
            Err(err) => return workspace_limit_error_response(err),
        }
    }

    match app_state
        .workflow_repo
        .create_workflow_run(
            workflow.user_id,
            workflow_id,
            workflow.workspace_id,
            snapshot,
            payload.idempotency_key.as_deref(),
        )
        .await
    {
        Ok(outcome) => {
            if let (Some(ticket), false) = (&workspace_quota, outcome.created) {
                let _ = app_state.release_workspace_run_quota(*ticket).await;
            }

            let run = outcome.run;
            let events = workflow_connection_metadata::build_run_events(
                &run,
                &triggered_by,
                &connection_metadata,
            );
            for event in events {
                if let Err(err) = app_state.workflow_repo.record_run_event(event).await {
                    eprintln!(
                        "Failed to record workflow rerun event {}: {:?}",
                        run.id, err
                    );
                }
            }

            (
                StatusCode::ACCEPTED,
                Json(json!({"success": true, "run": run})),
            )
                .into_response()
        }
        Err(e) => {
            if let Some(ticket) = workspace_quota {
                let _ = app_state.release_workspace_run_quota(ticket).await;
            }
            eprintln!("DB error creating rerun: {:?}", e);
            JsonResponse::server_error("Failed to enqueue rerun").into_response()
        }
    }
}

pub async fn rerun_from_failed_node(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((workflow_id, run_id)): Path<(Uuid, Uuid)>,
    Json(mut payload): Json<RerunRequest>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let workflow = match fetch_workflow_for_member(
        &app_state,
        user_id,
        workflow_id,
        "Failed to rerun",
    )
    .await
    {
        Ok(workflow) => workflow,
        Err(response) => return response,
    };

    let nodes = match app_state
        .workflow_repo
        .list_workflow_node_runs(workflow.user_id, workflow_id, run_id)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            eprintln!("DB error fetching node runs: {:?}", e);
            return JsonResponse::server_error("Failed to rerun").into_response();
        }
    };
    let failed = nodes
        .iter()
        .rev()
        .find(|n| n.status == "failed")
        .map(|n| n.node_id.clone());
    if let Some(node_id) = failed {
        payload.start_from_node_id = Some(node_id);
        rerun_workflow_run(
            State(app_state),
            AuthSession(claims),
            Path((workflow_id, run_id)),
            Json(payload),
        )
        .await
    } else {
        JsonResponse::bad_request("No failed node found for this run").into_response()
    }
}

// Download run JSON (run + node_runs)
pub async fn download_run_json(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((workflow_id, run_id)): Path<(Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let workflow =
        match fetch_workflow_for_member(&app_state, user_id, workflow_id, "Failed to download run")
            .await
        {
            Ok(workflow) => workflow,
            Err(response) => return response,
        };

    let run_opt = app_state
        .workflow_repo
        .get_workflow_run(workflow.user_id, workflow_id, run_id)
        .await;

    match run_opt {
        Ok(Some(run)) => {
            let nodes_res = app_state
                .workflow_repo
                .list_workflow_node_runs(workflow.user_id, workflow_id, run_id)
                .await;
            match nodes_res {
                Ok(node_runs) => {
                    let payload = json!({"run": run, "node_runs": node_runs});
                    let body = axum::Json(payload);
                    let mut resp = body.into_response();
                    resp.headers_mut().insert(
                        axum::http::header::CONTENT_DISPOSITION,
                        axum::http::HeaderValue::from_static("attachment; filename=run.json"),
                    );
                    resp
                }
                Err(e) => {
                    eprintln!("DB error listing node runs: {:?}", e);
                    JsonResponse::server_error("Failed to download run").into_response()
                }
            }
        }
        Ok(None) => JsonResponse::not_found("Run not found").into_response(),
        Err(e) => {
            eprintln!("DB error fetching run: {:?}", e);
            JsonResponse::server_error("Failed to download run").into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, OAuthProviderConfig, OAuthSettings, StripeSettings};
    use crate::db::{
        mock_db::{MockDb, StaticWorkspaceMembershipRepository},
        workflow_repository::{
            CreateWorkflowRunOutcome, MockWorkflowRepository, WorkflowRepository,
        },
        workspace_connection_repository::NoopWorkspaceConnectionRepository,
        workspace_repository::WorkspaceRepository,
    };
    use crate::models::{plan::PlanTier, workflow_run::WorkflowRun};
    use crate::routes::auth::claims::{Claims, TokenUse};
    use crate::routes::auth::session::AuthSession;
    use crate::services::{
        oauth::{
            github::mock_github_oauth::MockGitHubOAuth, google::mock_google_oauth::MockGoogleOAuth,
            workspace_service::WorkspaceOAuthService,
        },
        smtp_mailer::MockMailer,
    };
    use crate::state::{test_pg_pool, AppState};
    use crate::utils::jwt::JwtKeys;
    use axum::body::to_bytes;
    use reqwest::Client;
    use serde_json::Value;
    use sqlx::Error as SqlxError;
    use std::sync::Arc;
    use time::{Duration, OffsetDateTime};

    fn test_config() -> Arc<Config> {
        Arc::new(Config {
            database_url: "postgres://localhost/test".into(),
            frontend_origin: "https://app.example.com".into(),
            oauth: OAuthSettings {
                google: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "https://app.example.com/oauth/google".into(),
                },
                microsoft: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "https://app.example.com/oauth/microsoft".into(),
                },
                slack: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "https://app.example.com/oauth/slack".into(),
                },
                token_encryption_key: vec![0; 32],
            },
            api_secrets_encryption_key: vec![1; 32],
            stripe: StripeSettings {
                client_id: "stub".into(),
                secret_key: "stub".into(),
                webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            },
            auth_cookie_secure: true,
            webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            jwt_issuer: "test-issuer".into(),
            jwt_audience: "test-audience".into(),
        })
    }

    fn test_jwt_keys() -> Arc<JwtKeys> {
        Arc::new(
            JwtKeys::from_secret("0123456789abcdef0123456789abcdef")
                .expect("test JWT secret should be valid"),
        )
    }

    fn claims_fixture(user_id: Uuid, email: &str) -> Claims {
        Claims {
            id: user_id.to_string(),
            email: email.to_string(),
            exp: OffsetDateTime::now_utc().unix_timestamp() as usize + 3600,
            first_name: "Test".into(),
            last_name: "User".into(),
            role: None,
            plan: Some(PlanTier::Workspace.as_str().to_string()),
            company_name: None,
            iss: String::new(),
            aud: String::new(),
            token_use: TokenUse::Access,
        }
    }

    fn workflow_fixture(workspace_id: Uuid, owner_id: Uuid) -> Workflow {
        let now = OffsetDateTime::now_utc();
        Workflow {
            id: Uuid::new_v4(),
            user_id: owner_id,
            workspace_id: Some(workspace_id),
            name: "Workflow".into(),
            description: None,
            data: json!({
                "nodes": [],
                "edges": []
            }),
            concurrency_limit: 1,
            egress_allowlist: vec![],
            require_hmac: false,
            hmac_replay_window_sec: 300,
            webhook_salt: Uuid::new_v4(),
            locked_by: None,
            locked_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn run_fixture(workflow: &Workflow) -> WorkflowRun {
        let now = OffsetDateTime::now_utc();
        WorkflowRun {
            id: Uuid::new_v4(),
            user_id: workflow.user_id,
            workflow_id: workflow.id,
            workspace_id: workflow.workspace_id,
            snapshot: workflow.data.clone(),
            status: "running".into(),
            error: None,
            idempotency_key: None,
            started_at: now,
            finished_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn test_state(
        workflow_repo: Arc<dyn WorkflowRepository>,
        workspace_repo: Arc<dyn WorkspaceRepository>,
    ) -> AppState {
        AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo,
            workspace_repo,
            workspace_connection_repo: Arc::new(NoopWorkspaceConnectionRepository),
            db_pool: test_pg_pool(),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts: crate::services::oauth::account_service::OAuthAccountService::test_stub(
            ),
            workspace_oauth: WorkspaceOAuthService::test_stub(),
            stripe: Arc::new(crate::services::stripe::MockStripeService::new()),
            http_client: Arc::new(Client::new()),
            config: test_config(),
            worker_id: Arc::new("worker-1".into()),
            worker_lease_seconds: 30,
            jwt_keys: test_jwt_keys(),
        }
    }

    #[tokio::test]
    async fn start_workflow_run_returns_workspace_run_limit_error() {
        let workspace_id = Uuid::new_v4();
        let owner_id = Uuid::new_v4();
        let workflow = workflow_fixture(workspace_id, owner_id);
        let workflow_for_find = workflow.clone();

        let mut repo = MockWorkflowRepository::new();
        repo.expect_find_workflow_for_member()
            .returning(move |user, workflow_id| {
                let wf = workflow_for_find.clone();
                assert_eq!(user, wf.user_id);
                assert_eq!(workflow_id, wf.id);
                Box::pin(async move { Ok(Some(wf)) })
            });
        repo.expect_record_run_event()
            .returning(|_| Box::pin(async { Err(SqlxError::RowNotFound) }));

        let workspace_repo: Arc<StaticWorkspaceMembershipRepository> =
            Arc::new(StaticWorkspaceMembershipRepository::with_run_limit(0));
        let state = test_state(
            Arc::new(repo),
            workspace_repo.clone() as Arc<dyn WorkspaceRepository>,
        );

        let response = start_workflow_run(
            State(state),
            AuthSession(claims_fixture(owner_id, "member@example.com")),
            Path(workflow.id),
            None,
        )
        .await;

        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        let body = to_bytes(response.into_body(), 1024).await.unwrap();
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["code"], Value::String("workspace_run_limit".into()));
        assert_eq!(workspace_repo.release_calls(), 0);
        assert_eq!(workspace_repo.last_period_starts().len(), 1);
    }

    #[tokio::test]
    async fn start_workflow_run_releases_quota_when_idempotent() {
        let workspace_id = Uuid::new_v4();
        let owner_id = Uuid::new_v4();
        let workflow = workflow_fixture(workspace_id, owner_id);
        let workflow_for_find = workflow.clone();
        let run = run_fixture(&workflow);

        let mut repo = MockWorkflowRepository::new();
        repo.expect_find_workflow_for_member()
            .returning(move |_, _| {
                let wf = workflow_for_find.clone();
                Box::pin(async move { Ok(Some(wf)) })
            });
        repo.expect_create_workflow_run()
            .returning(move |_, _, _, _, _| {
                let run = run.clone();
                Box::pin(async move {
                    Ok(CreateWorkflowRunOutcome {
                        run,
                        created: false,
                    })
                })
            });
        repo.expect_record_run_event()
            .returning(|_| Box::pin(async { Err(SqlxError::RowNotFound) }));

        let workspace_repo: Arc<StaticWorkspaceMembershipRepository> =
            Arc::new(StaticWorkspaceMembershipRepository::with_run_limit(1));
        let period_start = OffsetDateTime::now_utc() - Duration::days(60);
        let period_end = period_start + Duration::days(30);
        workspace_repo
            .upsert_workspace_billing_cycle(workspace_id, "sub_123", period_start, period_end)
            .await
            .unwrap();

        let state = test_state(
            Arc::new(repo),
            workspace_repo.clone() as Arc<dyn WorkspaceRepository>,
        );

        let response = start_workflow_run(
            State(state),
            AuthSession(claims_fixture(owner_id, "member@example.com")),
            Path(workflow.id),
            None,
        )
        .await;

        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert_eq!(workspace_repo.release_calls(), 1);
        // The run ticket should use the billing cycle end because the current clock
        // is past the stored period end.
        let recorded = workspace_repo.last_period_starts();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0], period_end);
    }
}
