use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use crate::models::user::UserRole;
use crate::{responses::JsonResponse, routes::auth::session::AuthSession, state::AppState};

#[derive(Deserialize)]
pub struct PurgeRunsBody {
    pub days: Option<i32>,
}

pub async fn purge_runs(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Json(body): Json<PurgeRunsBody>,
) -> Response {
    if !matches!(claims.role, Some(UserRole::Admin)) {
        return (
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({"success": false, "message": "Admin only"})),
        )
            .into_response();
    }

    let days = body.days.unwrap_or_else(|| {
        std::env::var("RUN_RETENTION_DAYS")
            .ok()
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(30)
    });

    match app_state.workflow_repo.purge_old_runs(days).await {
        Ok(deleted) => (
            StatusCode::OK,
            axum::Json(serde_json::json!({"success": true, "deleted": deleted, "days": days })),
        )
            .into_response(),
        Err(e) => {
            eprintln!("admin purge: error: {:?}", e);
            JsonResponse::server_error("Failed to purge runs").into_response()
        }
    }
}
