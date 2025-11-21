use super::prelude::*;

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
        .find_workflow_for_member(user_id, workflow_id)
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
