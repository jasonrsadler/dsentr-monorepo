use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    responses::JsonResponse, routes::auth::session::AuthSession,
    services::oauth::account_service::OAuthAccountError, AppState,
};

#[derive(Deserialize)]
pub struct WorksheetQuery {
    pub connection_scope: String, // "personal" | "workspace" (we only honor personal for now)
    pub connection_id: String,    // UUID string
}

#[derive(Serialize)]
pub struct WorksheetListResponse {
    pub worksheets: Vec<String>,
}

// GET /api/google/sheets/:spreadsheet_id/worksheets
pub async fn list_worksheets(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    Path(spreadsheet_id): Path<String>,
    Query(query): Query<WorksheetQuery>,
) -> Response {
    let spreadsheet_id = spreadsheet_id.trim();
    if spreadsheet_id.is_empty() {
        return JsonResponse::bad_request("Spreadsheet ID is required").into_response();
    }

    // Claims.id is your user id string
    let user_id = match Uuid::parse_str(&session.id) {
        Ok(id) => id,
        Err(_) => {
            // Session is corrupt, this is on us, not the user
            return JsonResponse::server_error("Invalid user id in session").into_response();
        }
    };

    let connection_id = match Uuid::parse_str(&query.connection_id) {
        Ok(id) => id,
        Err(_) => {
            return JsonResponse::bad_request("Invalid connection_id").into_response();
        }
    };

    // For now, only support personal connections.
    // If connection_scope is "workspace", you can branch later.
    let result = state
        .oauth_accounts
        .list_personal_worksheets(user_id, connection_id, spreadsheet_id)
        .await;

    match result {
        Ok(worksheets) => axum::Json(WorksheetListResponse { worksheets }).into_response(),
        Err(OAuthAccountError::NotFound) => {
            JsonResponse::not_found("Google connection not found").into_response()
        }
        Err(OAuthAccountError::TokenExpired { .. }) => {
            JsonResponse::unauthorized("Google token expired, please reconnect Google")
                .into_response()
        }
        Err(other) => {
            JsonResponse::server_error(&format!("Google error: {other:?}")).into_response()
        }
    }
}
