use super::prelude::*;

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
