use axum::{
    extract::{Query, State},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    responses::JsonResponse,
    routes::auth::session::AuthSession,
    runaway_protection::{runaway_protection_enabled, set_runaway_protection_enabled},
    state::AppState,
};

#[derive(Default, Deserialize)]
pub struct UserSettingsQuery {
    #[serde(default)]
    workspace: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct UpdateUserSettingsBody {
    #[serde(default)]
    workspace_id: Option<Uuid>,
    runaway_protection_enabled: Option<bool>,
}

pub async fn get_user_settings(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Query(query): Query<UserSettingsQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let settings = match app_state.db.get_user_settings(user_id).await {
        Ok(val) => val,
        Err(err) => {
            tracing::error!(?err, %user_id, "failed to load user settings");
            return JsonResponse::server_error("Failed to load settings").into_response();
        }
    };

    let enabled = query
        .workspace
        .map(|workspace_id| runaway_protection_enabled(&settings, workspace_id))
        .unwrap_or(true);

    (
        axum::http::StatusCode::OK,
        Json(json!({
            "success": true,
            "settings": {
                "workflows": {
                    "runaway_protection_enabled": enabled
                }
            }
        })),
    )
        .into_response()
}

pub async fn update_user_settings(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Json(body): Json<UpdateUserSettingsBody>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let workspace_id = match body.workspace_id {
        Some(id) => id,
        None => {
            return JsonResponse::bad_request("workspace_id is required").into_response();
        }
    };

    let enabled = match body.runaway_protection_enabled {
        Some(flag) => flag,
        None => {
            return JsonResponse::bad_request("runaway_protection_enabled is required")
                .into_response()
        }
    };

    let mut settings = match app_state.db.get_user_settings(user_id).await {
        Ok(val) => val,
        Err(err) => {
            tracing::error!(?err, %user_id, "failed to load user settings");
            return JsonResponse::server_error("Failed to load settings").into_response();
        }
    };

    set_runaway_protection_enabled(&mut settings, workspace_id, enabled);

    if let Err(err) = app_state.db.update_user_settings(user_id, settings).await {
        tracing::error!(?err, %user_id, "failed to update user settings");
        return JsonResponse::server_error("Failed to save settings").into_response();
    }

    (
        axum::http::StatusCode::OK,
        Json(json!({
            "success": true,
            "settings": {
                "workflows": {
                    "runaway_protection_enabled": enabled
                }
            }
        })),
    )
        .into_response()
}
