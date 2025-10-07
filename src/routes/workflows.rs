use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
use uuid::Uuid;

use crate::{
    models::workflow::CreateWorkflow, responses::JsonResponse, routes::auth::session::AuthSession,
    state::AppState,
};

fn is_unique_violation(err: &sqlx::Error) -> bool {
    if let sqlx::Error::Database(db_err) = err {
        if let Some(code) = db_err.code() {
            return code == "23505"; // unique_violation
        }
    }
    false
}

fn flatten_user_data(prefix: &str, value: &serde_json::Value, out: &mut Vec<(String, serde_json::Value)>) {
    match value {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            for k in keys {
                let v = &map[k];
                let p = if prefix.is_empty() { k.to_string() } else { format!("{prefix}.{k}") };
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

fn diff_user_nodes_only(before: &serde_json::Value, after: &serde_json::Value) -> serde_json::Value {
    let mut bf: Vec<(String, serde_json::Value)> = Vec::new();
    let mut af: Vec<(String, serde_json::Value)> = Vec::new();

    let mut extract = |root: &serde_json::Value, out: &mut Vec<(String, serde_json::Value)>| {
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
    for (k, v) in bf { map_b.insert(k, v); }
    let mut map_a = std::collections::BTreeMap::new();
    for (k, v) in af { map_a.insert(k, v); }

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
        Ok(workflow) => (
            StatusCode::CREATED,
            Json(json!({
                "success": true,
                "workflow": workflow
            })),
        )
            .into_response(),
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
