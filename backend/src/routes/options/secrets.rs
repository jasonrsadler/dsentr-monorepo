use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    responses::JsonResponse,
    routes::auth::session::AuthSession,
    state::AppState,
    utils::secrets::{
        collect_workflow_secrets, ensure_secret_exists, read_secret_store, remove_named_secret,
        upsert_named_secret, write_secret_store, SecretUpsertOutcome, SecretValidationError,
    },
};

#[derive(Deserialize)]
pub(crate) struct SecretPayload {
    value: String,
}

fn canonicalize_key(input: &str) -> Result<String, Response> {
    let key = input.trim().to_lowercase();
    if key.is_empty() {
        Err(JsonResponse::bad_request("Section key cannot be empty").into_response())
    } else {
        Ok(key)
    }
}

pub async fn list_secrets(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let settings = match app_state.db.get_user_settings(user_id).await {
        Ok(settings) => settings,
        Err(e) => {
            eprintln!("Failed to load user settings: {:?}", e);
            return JsonResponse::server_error("Failed to load secrets").into_response();
        }
    };

    let store = read_secret_store(&settings);
    let secrets = serde_json::to_value(store).unwrap_or_else(|_| json!({}));

    (
        StatusCode::OK,
        Json(json!({ "success": true, "secrets": secrets })),
    )
        .into_response()
}

pub async fn upsert_secret(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((group, service, name)): Path<(String, String, String)>,
    Json(payload): Json<SecretPayload>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let group_key = match canonicalize_key(&group) {
        Ok(key) => key,
        Err(resp) => return resp,
    };
    let service_key = match canonicalize_key(&service) {
        Ok(key) => key,
        Err(resp) => return resp,
    };

    let mut settings = match app_state.db.get_user_settings(user_id).await {
        Ok(settings) => settings,
        Err(e) => {
            eprintln!("Failed to load user settings: {:?}", e);
            return JsonResponse::server_error("Failed to load secrets").into_response();
        }
    };

    let mut store = read_secret_store(&settings);
    let outcome =
        match upsert_named_secret(&mut store, &group_key, &service_key, &name, &payload.value) {
            Ok(outcome) => outcome,
            Err(SecretValidationError::EmptyName) => {
                return JsonResponse::bad_request("Secret name cannot be empty").into_response()
            }
            Err(SecretValidationError::EmptyValue) => {
                return JsonResponse::bad_request("Secret value cannot be empty").into_response()
            }
        };

    write_secret_store(&mut settings, &store);
    if let Err(e) = app_state.db.update_user_settings(user_id, settings).await {
        eprintln!("Failed to persist user secrets: {:?}", e);
        return JsonResponse::server_error("Failed to save secret").into_response();
    }

    let secrets = serde_json::to_value(store).unwrap_or_else(|_| json!({}));
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "outcome": match outcome {
                SecretUpsertOutcome::Created => "created",
                SecretUpsertOutcome::Updated => "updated",
                SecretUpsertOutcome::Unchanged => "unchanged",
            },
            "secrets": secrets
        })),
    )
        .into_response()
}

pub async fn delete_secret(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((group, service, name)): Path<(String, String, String)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let group_key = match canonicalize_key(&group) {
        Ok(key) => key,
        Err(resp) => return resp,
    };
    let service_key = match canonicalize_key(&service) {
        Ok(key) => key,
        Err(resp) => return resp,
    };

    let mut settings = match app_state.db.get_user_settings(user_id).await {
        Ok(settings) => settings,
        Err(e) => {
            eprintln!("Failed to load user settings: {:?}", e);
            return JsonResponse::server_error("Failed to load secrets").into_response();
        }
    };

    let mut store = read_secret_store(&settings);
    if !remove_named_secret(&mut store, &group_key, &service_key, &name) {
        return JsonResponse::not_found("Secret not found").into_response();
    }

    write_secret_store(&mut settings, &store);
    if let Err(e) = app_state.db.update_user_settings(user_id, settings).await {
        eprintln!("Failed to persist user secrets: {:?}", e);
        return JsonResponse::server_error("Failed to delete secret").into_response();
    }

    let secrets = serde_json::to_value(store).unwrap_or_else(|_| json!({}));
    (
        StatusCode::OK,
        Json(json!({ "success": true, "secrets": secrets })),
    )
        .into_response()
}

/// Helper used by workflow routes to sync secrets.
pub async fn sync_secrets_from_workflow(
    app_state: &AppState,
    user_id: Uuid,
    workflow_data: &serde_json::Value,
) {
    let Ok(mut settings) = app_state.db.get_user_settings(user_id).await else {
        return;
    };
    let mut store = read_secret_store(&settings);
    let mut changed = false;
    for (group, service, value) in collect_workflow_secrets(workflow_data) {
        if ensure_secret_exists(&mut store, &group, &service, &value) {
            changed = true;
        }
    }
    if changed {
        write_secret_store(&mut settings, &store);
        if let Err(e) = app_state.db.update_user_settings(user_id, settings).await {
            eprintln!("Failed to sync workflow secrets: {:?}", e);
        }
    }
}
