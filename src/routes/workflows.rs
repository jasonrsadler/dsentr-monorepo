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
            JsonResponse::server_error("Failed to create workflow").into_response()
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

    match app_state
        .workflow_repo
        .update_workflow(user_id, workflow_id, &name, description.as_deref(), data)
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
            eprintln!("DB error updating workflow: {:?}", e);
            JsonResponse::server_error("Failed to update workflow").into_response()
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
