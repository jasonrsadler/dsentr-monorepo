use super::prelude::*;

pub async fn list_workflow_logs(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let wf_meta = app_state
        .workflow_repo
        .find_workflow_by_id(user_id, workflow_id)
        .await;

    let plan_tier = app_state
        .resolve_plan_tier(user_id, claims.plan.as_deref())
        .await;

    match app_state
        .workflow_repo
        .list_workflow_logs(user_id, workflow_id, 200, 0)
        .await
    {
        Ok(entries) => {
            let filtered = if plan_tier.is_solo() {
                let cutoff = OffsetDateTime::now_utc() - TimeDuration::hours(24);
                entries
                    .into_iter()
                    .filter(|entry| entry.created_at >= cutoff)
                    .collect::<Vec<_>>()
            } else {
                entries
            };
            let mut payload = json!({"success": true, "logs": filtered});
            if let Ok(Some(wf)) = wf_meta {
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
