use axum::{
    extract::{Json, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use base64::Engine;
use serde_json::json;
use uuid::Uuid;

use crate::{
    models::workflow::{CreateWorkflow, Workflow},
    responses::JsonResponse,
    routes::{auth::session::AuthSession, options::secrets::sync_secrets_from_workflow},
    state::AppState,
    utils::schedule::{compute_next_run, offset_to_utc, parse_schedule_config, utc_to_offset},
};
use async_stream::stream;
use axum::response::sse::{Event, KeepAlive, Sse};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use std::convert::Infallible;
use std::time::Duration;

fn is_unique_violation(err: &sqlx::Error) -> bool {
    if let sqlx::Error::Database(db_err) = err {
        if let Some(code) = db_err.code() {
            return code == "23505"; // unique_violation
        }
    }
    false
}

fn flatten_user_data(
    prefix: &str,
    value: &serde_json::Value,
    out: &mut Vec<(String, serde_json::Value)>,
) {
    match value {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            for k in keys {
                let v = &map[k];
                let p = if prefix.is_empty() {
                    k.to_string()
                } else {
                    format!("{prefix}.{k}")
                };
                flatten_user_data(&p, v, out);
            }
        }
        serde_json::Value::Array(arr) => {
            for (i, v) in arr.iter().enumerate() {
                let p = format!("{prefix}[{i}]");
                flatten_user_data(&p, v, out);
            }
        }
        _ => out.push((prefix.to_string(), value.clone())),
    }
}

fn diff_user_nodes_only(
    before: &serde_json::Value,
    after: &serde_json::Value,
) -> serde_json::Value {
    let mut bf: Vec<(String, serde_json::Value)> = Vec::new();
    let mut af: Vec<(String, serde_json::Value)> = Vec::new();

    let extract = |root: &serde_json::Value, out: &mut Vec<(String, serde_json::Value)>| {
        if let Some(nodes) = root.get("nodes").and_then(|v| v.as_array()) {
            for (i, node) in nodes.iter().enumerate() {
                if let Some(data) = node.get("data") {
                    flatten_user_data(&format!("nodes[{i}].data"), data, out);
                }
            }
        }
    };
    extract(before, &mut bf);
    extract(after, &mut af);

    let mut map_b = std::collections::BTreeMap::new();
    for (k, v) in bf {
        map_b.insert(k, v);
    }
    let mut map_a = std::collections::BTreeMap::new();
    for (k, v) in af {
        map_a.insert(k, v);
    }

    let mut diffs = vec![];
    let keys: std::collections::BTreeSet<_> = map_b.keys().chain(map_a.keys()).cloned().collect();
    for k in keys {
        let b = map_b.get(&k);
        let a = map_a.get(&k);
        if b != a {
            diffs.push(json!({
                "path": k,
                "from": b.cloned().unwrap_or(serde_json::Value::Null),
                "to": a.cloned().unwrap_or(serde_json::Value::Null)
            }));
        }
    }
    serde_json::Value::Array(diffs)
}

fn extract_schedule_config(graph: &serde_json::Value) -> Option<serde_json::Value> {
    let nodes = graph.get("nodes")?.as_array()?;
    for node in nodes {
        if node.get("type")?.as_str()? != "trigger" {
            continue;
        }
        let data = node.get("data")?;
        let trigger_type = data
            .get("triggerType")
            .and_then(|v| v.as_str())
            .unwrap_or("Manual");
        if !trigger_type.eq_ignore_ascii_case("schedule") {
            continue;
        }
        if let Some(cfg) = data.get("scheduleConfig") {
            return Some(cfg.clone());
        }
    }
    None
}

async fn sync_workflow_schedule(state: &AppState, workflow: &Workflow) {
    if let Err(err) = sync_workflow_schedule_inner(state, workflow).await {
        eprintln!(
            "Failed to sync schedule for workflow {}: {:?}",
            workflow.id, err
        );
    }
}

async fn sync_workflow_schedule_inner(
    state: &AppState,
    workflow: &Workflow,
) -> Result<(), sqlx::Error> {
    let schedule_value = extract_schedule_config(&workflow.data);
    let existing = state
        .workflow_repo
        .get_schedule_for_workflow(workflow.id)
        .await?;

    match schedule_value {
        Some(cfg_value) => {
            if let Some(cfg) = parse_schedule_config(&cfg_value) {
                let last_run = existing
                    .as_ref()
                    .and_then(|s| s.last_run_at)
                    .and_then(offset_to_utc);
                let now = Utc::now();
                if let Some(next_dt) = compute_next_run(&cfg, last_run, now) {
                    if let Some(next_offset) = utc_to_offset(next_dt) {
                        state
                            .workflow_repo
                            .upsert_workflow_schedule(
                                workflow.user_id,
                                workflow.id,
                                cfg_value,
                                Some(next_offset),
                            )
                            .await?;
                    } else {
                        state
                            .workflow_repo
                            .disable_workflow_schedule(workflow.id)
                            .await?;
                    }
                } else {
                    state
                        .workflow_repo
                        .disable_workflow_schedule(workflow.id)
                        .await?;
                }
            } else {
                state
                    .workflow_repo
                    .disable_workflow_schedule(workflow.id)
                    .await?;
            }
        }
        None => {
            state
                .workflow_repo
                .disable_workflow_schedule(workflow.id)
                .await?;
        }
    }

    Ok(())
}

pub async fn create_workflow(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Json(payload): Json<CreateWorkflow>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let CreateWorkflow {
        name,
        description,
        data,
    } = payload;

    let result = app_state
        .workflow_repo
        .create_workflow(user_id, &name, description.as_deref(), data)
        .await;

    match result {
        Ok(workflow) => {
            sync_workflow_schedule(&app_state, &workflow).await;
            sync_secrets_from_workflow(&app_state, user_id, &workflow.data).await;
            (
                StatusCode::CREATED,
                Json(json!({
                    "success": true,
                    "workflow": workflow
                })),
            )
                .into_response()
        }
        Err(e) => {
            eprintln!("DB error creating workflow: {:?}", e);
            if is_unique_violation(&e) {
                JsonResponse::conflict("A workflow with this name already exists").into_response()
            } else {
                JsonResponse::server_error("Failed to create workflow").into_response()
            }
        }
    }
}

pub async fn list_workflows(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    match app_state
        .workflow_repo
        .list_workflows_by_user(user_id)
        .await
    {
        Ok(workflows) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "workflows": workflows
            })),
        )
            .into_response(),
        Err(e) => {
            eprintln!("DB error listing workflows: {:?}", e);
            JsonResponse::server_error("Failed to fetch workflows").into_response()
        }
    }
}

pub async fn get_workflow(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    match app_state
        .workflow_repo
        .find_workflow_by_id(user_id, workflow_id)
        .await
    {
        Ok(Some(workflow)) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "workflow": workflow
            })),
        )
            .into_response(),
        Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error fetching workflow: {:?}", e);
            JsonResponse::server_error("Failed to fetch workflow").into_response()
        }
    }
}

pub async fn update_workflow(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Json(payload): Json<CreateWorkflow>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let CreateWorkflow {
        name,
        description,
        data,
    } = payload;

    let before = app_state
        .workflow_repo
        .find_workflow_by_id(user_id, workflow_id)
        .await;

    match app_state
        .workflow_repo
        .update_workflow(user_id, workflow_id, &name, description.as_deref(), data)
        .await
    {
        Ok(Some(workflow)) => {
            sync_workflow_schedule(&app_state, &workflow).await;
            if let Ok(Some(before_wf)) = before {
                let diffs = diff_user_nodes_only(&before_wf.data, &workflow.data);
                if let Err(e) = app_state
                    .workflow_repo
                    .insert_workflow_log(user_id, workflow.id, diffs)
                    .await
                {
                    eprintln!("Failed to insert workflow log: {:?}", e);
                }
            }
            sync_secrets_from_workflow(&app_state, user_id, &workflow.data).await;
            (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "workflow": workflow
                })),
            )
                .into_response()
        }
        Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error updating workflow: {:?}", e);
            if is_unique_violation(&e) {
                JsonResponse::conflict("A workflow with this name already exists").into_response()
            } else {
                JsonResponse::server_error("Failed to update workflow").into_response()
            }
        }
    }
}

pub async fn list_workflow_logs(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    // Fetch workflow meta (for name) and logs
    let wf_meta = app_state
        .workflow_repo
        .find_workflow_by_id(user_id, workflow_id)
        .await;

    match app_state
        .workflow_repo
        .list_workflow_logs(user_id, workflow_id, 200, 0)
        .await
    {
        Ok(entries) => {
            let mut payload = json!({"success": true, "logs": entries});
            if let Ok(Some(wf)) = wf_meta {
                // Attach minimal workflow info to help the client display context
                payload["workflow"] = json!({ "id": wf.id, "name": wf.name });
            }
            (StatusCode::OK, Json(payload)).into_response()
        }
        Err(e) => {
            eprintln!("DB error listing logs: {:?}", e);
            JsonResponse::server_error("Failed to fetch logs").into_response()
        }
    }
}

pub async fn delete_workflow_log_entry(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((workflow_id, log_id)): Path<(Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    match app_state
        .workflow_repo
        .delete_workflow_log(user_id, workflow_id, log_id)
        .await
    {
        Ok(true) => Json(json!({"success": true})).into_response(),
        Ok(false) => JsonResponse::not_found("Log not found").into_response(),
        Err(e) => {
            eprintln!("DB error deleting log: {:?}", e);
            JsonResponse::server_error("Failed to delete log").into_response()
        }
    }
}

pub async fn clear_workflow_logs(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    match app_state
        .workflow_repo
        .clear_workflow_logs(user_id, workflow_id)
        .await
    {
        Ok(_count) => Json(json!({"success": true})).into_response(),
        Err(e) => {
            eprintln!("DB error clearing logs: {:?}", e);
            JsonResponse::server_error("Failed to clear logs").into_response()
        }
    }
}
pub async fn delete_workflow(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    match app_state
        .workflow_repo
        .delete_workflow(user_id, workflow_id)
        .await
    {
        Ok(true) => Json(json!({ "success": true })).into_response(),
        Ok(false) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error deleting workflow: {:?}", e);
            JsonResponse::server_error("Failed to delete workflow").into_response()
        }
    }
}

type HmacSha256 = Hmac<Sha256>;

fn compute_webhook_token(secret: &str, user_id: Uuid, workflow_id: Uuid, salt: Uuid) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(user_id.as_bytes());
    mac.update(workflow_id.as_bytes());
    mac.update(salt.as_bytes());
    let res = mac.finalize().into_bytes();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(res)
}

fn compute_webhook_signing_key(
    secret: &str,
    user_id: Uuid,
    workflow_id: Uuid,
    salt: Uuid,
) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(user_id.as_bytes());
    mac.update(workflow_id.as_bytes());
    mac.update(salt.as_bytes());
    mac.update(b"signing");
    let res = mac.finalize().into_bytes();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(res)
}

#[derive(Deserialize)]
pub struct StartWorkflowRunRequest {
    pub idempotency_key: Option<String>,
    pub context: Option<serde_json::Value>,
    pub priority: Option<i32>,
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

    // Ensure workflow exists and belongs to user
    let wf = match app_state
        .workflow_repo
        .find_workflow_by_id(user_id, workflow_id)
        .await
    {
        Ok(Some(w)) => w,
        Ok(None) => return JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error fetching workflow before run: {:?}", e);
            return JsonResponse::server_error("Failed to start run").into_response();
        }
    };

    // Extract once to avoid borrow/move conflict
    let (idempotency_key_owned, trigger_ctx, priority) = match payload {
        Some(Json(req)) => (req.idempotency_key, req.context, req.priority),
        None => (None, None, None),
    };
    let idempotency_key = idempotency_key_owned.as_deref();

    // Snapshot the graph (immutable)
    let mut snapshot = wf.data.clone();
    if let Some(ctx) = trigger_ctx {
        snapshot["_trigger_context"] = ctx;
    }
    // Attach per-workflow egress allowlist for engine
    snapshot["_egress_allowlist"] = serde_json::Value::Array(
        wf.egress_allowlist
            .iter()
            .cloned()
            .map(serde_json::Value::String)
            .collect(),
    );

    match app_state
        .workflow_repo
        .create_workflow_run(user_id, workflow_id, snapshot, idempotency_key)
        .await
    {
        Ok(run) => {
            if let Some(p) = priority {
                let _ = app_state
                    .workflow_repo
                    .set_run_priority(user_id, workflow_id, run.id, p)
                    .await;
            }
            (
                StatusCode::ACCEPTED,
                Json(json!({
                    "success": true,
                    "run": run
                })),
            )
                .into_response()
        }
        Err(e) => {
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

    match app_state
        .workflow_repo
        .get_workflow_run(user_id, workflow_id, run_id)
        .await
    {
        Ok(Some(run)) => {
            let nodes_res = app_state
                .workflow_repo
                .list_workflow_node_runs(user_id, workflow_id, run_id)
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
    match app_state
        .workflow_repo
        .cancel_workflow_run(user_id, workflow_id, run_id)
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
    match app_state
        .workflow_repo
        .list_active_runs(user_id, params.workflow_id)
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

    match app_state
        .workflow_repo
        .list_runs_paged(
            user_id,
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

    match app_state
        .workflow_repo
        .cancel_all_runs_for_workflow(user_id, workflow_id)
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

    // Fetch the original run to get snapshot
    let base_run = match app_state
        .workflow_repo
        .get_workflow_run(user_id, workflow_id, run_id)
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

    match app_state
        .workflow_repo
        .create_workflow_run(
            user_id,
            workflow_id,
            snapshot,
            payload.idempotency_key.as_deref(),
        )
        .await
    {
        Ok(run) => (
            StatusCode::ACCEPTED,
            Json(json!({"success": true, "run": run})),
        )
            .into_response(),
        Err(e) => {
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
    let nodes = match app_state
        .workflow_repo
        .list_workflow_node_runs(user_id, workflow_id, run_id)
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
        .and_then(|n| Some(n.node_id.clone()));
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

    let run_opt = app_state
        .workflow_repo
        .get_workflow_run(user_id, workflow_id, run_id)
        .await;

    match run_opt {
        Ok(Some(run)) => {
            let nodes_res = app_state
                .workflow_repo
                .list_workflow_node_runs(user_id, workflow_id, run_id)
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

// Server-Sent Events for run + node updates
pub async fn sse_run_events(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((workflow_id, run_id)): Path<(Uuid, Uuid)>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let user_id = Uuid::parse_str(&claims.id).ok();

    let state = app_state.clone();
    let s = stream! {
        let mut last_run_updated: Option<time::OffsetDateTime> = None;
        let mut last_node_updated: Option<time::OffsetDateTime> = None;
        let mut intv = tokio::time::interval(Duration::from_millis(800));
        loop {
            intv.tick().await;
            // If not authorized, emit error once and end
            if user_id.is_none() {
                let ev = Event::default().event("error").json_data(json!({"error": "unauthorized"})).unwrap();
                yield Ok::<Event, Infallible>(ev);
                break;
            }
            let uid = user_id.unwrap();
            // Send run update if newer
            if let Ok(Some(run)) = state
                .workflow_repo
                .get_workflow_run(uid, workflow_id, run_id)
                .await
            {
                if last_run_updated.map(|t| t < run.updated_at).unwrap_or(true) {
                    last_run_updated = Some(run.updated_at);
                    let ev = Event::default().event("run").json_data(&run).unwrap();
                    yield Ok::<Event, Infallible>(ev);
                }
            }

            // Send node runs if any updated
            if let Ok(nodes) = state
                .workflow_repo
                .list_workflow_node_runs(uid, workflow_id, run_id)
                .await
            {
                if let Some(max_upd) = nodes.iter().map(|n| n.updated_at).max() {
                    if last_node_updated.map(|t| t < max_upd).unwrap_or(true) {
                        last_node_updated = Some(max_upd);
                        let ev = Event::default().event("node_runs").json_data(&nodes).unwrap();
                        yield Ok::<Event, Infallible>(ev);
                    }
                }
            }

            // keep alive tick every ~10s to prevent proxies from closing
        }
    };

    Sse::new(s).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(10))
            .text("keepalive"),
    )
}

// Protected endpoint to fetch a webhook URL for a workflow (for display in UI)
pub async fn get_webhook_url(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    match app_state
        .workflow_repo
        .find_workflow_by_id(user_id, workflow_id)
        .await
    {
        Ok(Some(wf)) => {
            let secret = std::env::var("WEBHOOK_SECRET").unwrap_or_else(|_| "dev-secret".into());
            let token = compute_webhook_token(&secret, wf.user_id, wf.id, wf.webhook_salt);
            let url = format!("/api/workflows/{}/trigger/{}", wf.id, token);
            (StatusCode::OK, Json(json!({"success": true, "url": url }))).into_response()
        }
        Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error: {:?}", e);
            JsonResponse::server_error("Failed to get webhook URL").into_response()
        }
    }
}

// Public webhook trigger (no CSRF, no session). Body JSON becomes trigger context
pub async fn webhook_trigger(
    State(app_state): State<AppState>,
    Path((workflow_id, token)): Path<(Uuid, String)>,
    body: Option<Json<serde_json::Value>>,
) -> Response {
    // Fetch workflow without user auth
    let wf = match app_state
        .workflow_repo
        .find_workflow_by_id_public(workflow_id)
        .await
    {
        Ok(Some(w)) => w,
        Ok(None) => return JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error: {:?}", e);
            return JsonResponse::server_error("Failed to enqueue").into_response();
        }
    };

    // Verify token
    let secret = std::env::var("WEBHOOK_SECRET").unwrap_or_else(|_| "dev-secret".into());
    let expected = compute_webhook_token(&secret, wf.user_id, wf.id, wf.webhook_salt);
    if token != expected {
        return JsonResponse::unauthorized("Invalid token").into_response();
    }

    // Optional HMAC body signature + replay
    if wf.require_hmac {
        // timestamp window check
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let signing_key_b64 =
            compute_webhook_signing_key(&secret, wf.user_id, wf.id, wf.webhook_salt);

        // Extract headers via http::request extensions is not available here; use a workaround: require timestamp/signature in body under _meta if header not present.
        // For now, accept either headers (preferred, via Proxy) or fields in JSON: _dsentr_ts, _dsentr_sig
        // This keeps UI examples working even in limited environments.
        let (ts_str, sig_str) = {
            let ts = std::env::var("X_DSENTR_TS_OVERRIDE").ok();
            let sg = std::env::var("X_DSENTR_SIG_OVERRIDE").ok();
            if ts.is_some() && sg.is_some() {
                (ts.unwrap(), sg.unwrap())
            } else if let Some(Json(ref b)) = body {
                let ts_v = b
                    .get("_dsentr_ts")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let sg_v = b
                    .get("_dsentr_sig")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                (ts_v, sg_v)
            } else {
                (String::new(), String::new())
            }
        };

        if ts_str.is_empty() || sig_str.is_empty() {
            return JsonResponse::unauthorized("Missing HMAC signature").into_response();
        }
        let ts = ts_str.parse::<i64>().unwrap_or(0);
        if ts <= 0 || (now - ts).abs() as i32 > wf.hmac_replay_window_sec {
            return JsonResponse::unauthorized("Stale or invalid timestamp").into_response();
        }
        // payload to sign: `${ts}.${raw_body}` where raw_body is compact JSON or empty
        let raw_body = body
            .as_ref()
            .map(|Json(v)| v.to_string())
            .unwrap_or_else(|| String::from(""));
        let payload = format!("{}.{}", ts_str, raw_body);
        // verify
        let key_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(signing_key_b64.as_bytes())
            .unwrap_or_default();
        let mut mac = HmacSha256::new_from_slice(&key_bytes).expect("HMAC");
        mac.update(payload.as_bytes());
        let expected = hex::encode(mac.finalize().into_bytes());
        let provided = sig_str.strip_prefix("v1=").unwrap_or(sig_str.as_str());
        if subtle::ConstantTimeEq::ct_eq(expected.as_bytes(), provided.as_bytes()).unwrap_u8()
            == 0u8
        {
            return JsonResponse::unauthorized("Invalid HMAC signature").into_response();
        }
        // Replay protection
        if let Ok(false) = app_state
            .workflow_repo
            .try_record_webhook_signature(wf.id, provided)
            .await
        {
            return JsonResponse::unauthorized("Replay detected").into_response();
        }
    }

    // Snapshot with trigger context
    let mut snapshot = wf.data.clone();
    if let Some(Json(ctx)) = body {
        snapshot["_trigger_context"] = ctx;
    }
    // Attach per-workflow egress allowlist for engine
    snapshot["_egress_allowlist"] = serde_json::Value::Array(
        wf.egress_allowlist
            .iter()
            .cloned()
            .map(serde_json::Value::String)
            .collect(),
    );

    match app_state
        .workflow_repo
        .create_workflow_run(wf.user_id, wf.id, snapshot, None)
        .await
    {
        Ok(run) => (
            StatusCode::ACCEPTED,
            Json(json!({"success": true, "run": run})),
        )
            .into_response(),
        Err(e) => {
            eprintln!("DB error creating run: {:?}", e);
            JsonResponse::server_error("Failed to enqueue run").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct UpdateEgressBody {
    pub allowlist: Vec<String>,
}

pub async fn get_egress_allowlist(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    match app_state
        .workflow_repo
        .find_workflow_by_id(user_id, workflow_id)
        .await
    {
        Ok(Some(wf)) => (
            StatusCode::OK,
            Json(json!({"success": true, "allowlist": wf.egress_allowlist })),
        )
            .into_response(),
        Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(_) => JsonResponse::server_error("Failed").into_response(),
    }
}

pub async fn set_egress_allowlist(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Json(body): Json<UpdateEgressBody>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    match app_state
        .workflow_repo
        .set_egress_allowlist(user_id, workflow_id, &body.allowlist)
        .await
    {
        Ok(true) => (StatusCode::OK, Json(json!({"success": true }))).into_response(),
        Ok(false) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(_) => JsonResponse::server_error("Failed to update allowlist").into_response(),
    }
}

#[derive(Deserialize)]
pub struct WebhookConfigBody {
    pub require_hmac: bool,
    pub replay_window_sec: i32,
}

pub async fn get_webhook_config(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    match app_state
        .workflow_repo
        .find_workflow_by_id(user_id, workflow_id)
        .await
    {
        Ok(Some(wf)) => {
            let secret = std::env::var("WEBHOOK_SECRET").unwrap_or_else(|_| "dev-secret".into());
            let signing_key =
                compute_webhook_signing_key(&secret, wf.user_id, wf.id, wf.webhook_salt);
            (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "require_hmac": wf.require_hmac,
                    "replay_window_sec": wf.hmac_replay_window_sec,
                    "signing_key": signing_key
                })),
            )
                .into_response()
        }
        Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(_) => JsonResponse::server_error("Failed").into_response(),
    }
}

pub async fn set_webhook_config(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Json(body): Json<WebhookConfigBody>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let replay = body.replay_window_sec.clamp(60, 3600);
    match app_state
        .workflow_repo
        .update_webhook_config(user_id, workflow_id, body.require_hmac, replay)
        .await
    {
        Ok(true) => (StatusCode::OK, Json(json!({"success": true }))).into_response(),
        Ok(false) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(_) => JsonResponse::server_error("Failed to update").into_response(),
    }
}

#[derive(Deserialize)]
pub struct ListEgressBlocksQuery {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

pub async fn list_egress_block_events(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Query(params): Query<ListEgressBlocksQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let per_page = params.per_page.unwrap_or(20).clamp(1, 100);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * per_page;
    match app_state
        .workflow_repo
        .list_egress_block_events(user_id, workflow_id, per_page, offset)
        .await
    {
        Ok(items) => (
            StatusCode::OK,
            Json(json!({"success": true, "blocks": items, "page": page, "per_page": per_page })),
        )
            .into_response(),
        Err(_) => JsonResponse::server_error("Failed to fetch blocks").into_response(),
    }
}

// SSE: per-workflow active runs stream
pub async fn sse_workflow_runs(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => Uuid::nil(),
    };
    let state = app_state.clone();
    let s = stream! {
        let mut last_ids: Option<Vec<(Uuid, String)>> = None;
        let mut intv = tokio::time::interval(Duration::from_millis(1000));
        loop {
            intv.tick().await;
            if user_id.is_nil() { yield Ok::<Event, Infallible>(Event::default().event("error").data("unauthorized")); break; }
            match state.workflow_repo.list_active_runs(user_id, Some(workflow_id)).await {
                Ok(runs) => {
                    let ids: Vec<(Uuid, String)> = runs.iter().map(|r| (r.id, r.status.clone())).collect();
                    let changed = last_ids.as_ref().map(|prev| prev != &ids).unwrap_or(true);
                    if changed {
                        last_ids = Some(ids);
                        let ev = Event::default().event("runs").json_data(&runs).unwrap();
                        yield Ok::<Event, Infallible>(ev);
                    } else {
                        yield Ok::<Event, Infallible>(Event::default().event("tick").data("{}"));
                    }
                }
                Err(_) => {
                    yield Ok::<Event, Infallible>(Event::default().event("error").data("fetch_failed"));
                }
            }
        }
    };
    Sse::new(s).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(10))
            .text("keepalive"),
    )
}

// SSE: global active runs status stream
pub async fn sse_global_runs(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => Uuid::nil(),
    };
    let state = app_state.clone();
    let s = stream! {
        let mut last: Option<(bool,bool)> = None;
        let mut intv = tokio::time::interval(Duration::from_millis(1500));
        loop {
            intv.tick().await;
            if user_id.is_nil() { yield Ok::<Event, Infallible>(Event::default().event("error").data("unauthorized")); break; }
            match state.workflow_repo.list_active_runs(user_id, None).await {
                Ok(runs) => {
                    let has_running = runs.iter().any(|r| r.status == "running");
                    let has_queued = runs.iter().any(|r| r.status == "queued");
                    let cur = (has_running, has_queued);
                    if last.map(|p| p != cur).unwrap_or(true) {
                        last = Some(cur);
                        let ev = Event::default().event("status").json_data(serde_json::json!({"has_running": has_running, "has_queued": has_queued})).unwrap();
                        yield Ok::<Event, Infallible>(ev);
                    } else {
                        yield Ok::<Event, Infallible>(Event::default().event("tick").data("{}"));
                    }
                }
                Err(_) => {
                    yield Ok::<Event, Infallible>(Event::default().event("error").data("fetch_failed"));
                }
            }
        }
    };
    Sse::new(s).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(10))
            .text("keepalive"),
    )
}

pub async fn clear_egress_block_events(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    match app_state
        .workflow_repo
        .clear_egress_block_events(user_id, workflow_id)
        .await
    {
        Ok(count) => (
            StatusCode::OK,
            Json(json!({"success": true, "deleted": count })),
        )
            .into_response(),
        Err(_) => JsonResponse::server_error("Failed to clear blocks").into_response(),
    }
}

pub async fn clear_dead_letters_api(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    match app_state
        .workflow_repo
        .clear_dead_letters(user_id, workflow_id)
        .await
    {
        Ok(count) => (
            StatusCode::OK,
            Json(json!({"success": true, "deleted": count })),
        )
            .into_response(),
        Err(_) => JsonResponse::server_error("Failed to clear dead letters").into_response(),
    }
}

pub async fn regenerate_webhook_token(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    match app_state
        .workflow_repo
        .rotate_webhook_salt(user_id, workflow_id)
        .await
    {
        Ok(Some(new_salt)) => {
            let wf = app_state
                .workflow_repo
                .find_workflow_by_id(user_id, workflow_id)
                .await;
            match wf {
                Ok(Some(w)) => {
                    let secret =
                        std::env::var("WEBHOOK_SECRET").unwrap_or_else(|_| "dev-secret".into());
                    let token = compute_webhook_token(&secret, w.user_id, w.id, new_salt);
                    let url = format!("/api/workflows/{}/trigger/{}", w.id, token);
                    (StatusCode::OK, Json(json!({"success": true, "url": url}))).into_response()
                }
                Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
                Err(e) => {
                    eprintln!("DB error: {:?}", e);
                    JsonResponse::server_error("Failed to regenerate").into_response()
                }
            }
        }
        Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error rotating salt: {:?}", e);
            JsonResponse::server_error("Failed to regenerate").into_response()
        }
    }
}

// Concurrency limit setter
#[derive(Deserialize)]
pub struct ConcurrencyLimitBody {
    pub limit: i32,
}

pub async fn set_concurrency_limit(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Json(body): Json<ConcurrencyLimitBody>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if body.limit < 1 {
        return JsonResponse::bad_request("limit must be >= 1").into_response();
    }
    match app_state
        .workflow_repo
        .set_workflow_concurrency_limit(user_id, workflow_id, body.limit)
        .await
    {
        Ok(true) => Json(json!({"success": true, "limit": body.limit})).into_response(),
        Ok(false) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error setting concurrency: {:?}", e);
            JsonResponse::server_error("Failed to update").into_response()
        }
    }
}

// Dead letters list
#[derive(Deserialize)]
pub struct ListDeadLettersQuery {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

pub async fn list_dead_letters(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Query(params): Query<ListDeadLettersQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let per_page = params.per_page.unwrap_or(20).clamp(1, 100);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * per_page;
    match app_state
        .workflow_repo
        .list_dead_letters(user_id, workflow_id, per_page, offset)
        .await
    {
        Ok(items) => (
            StatusCode::OK,
            Json(
                json!({"success": true, "dead_letters": items, "page": page, "per_page": per_page}),
            ),
        )
            .into_response(),
        Err(e) => {
            eprintln!("DB error list dead letters: {:?}", e);
            JsonResponse::server_error("Failed to fetch").into_response()
        }
    }
}

pub async fn requeue_dead_letter(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((workflow_id, dead_id)): Path<(Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    match app_state
        .workflow_repo
        .requeue_dead_letter(user_id, workflow_id, dead_id)
        .await
    {
        Ok(Some(run)) => (
            StatusCode::ACCEPTED,
            Json(json!({"success": true, "run": run})),
        )
            .into_response(),
        Ok(None) => JsonResponse::not_found("Dead letter not found").into_response(),
        Err(e) => {
            eprintln!("DB error requeue dead letter: {:?}", e);
            JsonResponse::server_error("Failed to requeue").into_response()
        }
    }
}
