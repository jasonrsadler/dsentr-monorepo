use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    models::workspace::WorkspaceRole,
    responses::JsonResponse,
    routes::auth::session::AuthSession,
    state::AppState,
    utils::secrets::{
        collect_workflow_secrets, ensure_secret_exists, extend_response_store, read_secret_store,
        remove_named_secret, to_response_store, upsert_named_secret, write_secret_store,
        SecretResponseStore, SecretUpsertOutcome, SecretValidationError,
    },
};

#[derive(Deserialize)]
pub(crate) struct SecretPayload {
    value: String,
}

#[derive(Default, Deserialize)]
pub(crate) struct SecretsQuery {
    #[serde(default)]
    workspace: Option<Uuid>,
}

#[allow(clippy::result_large_err)]
fn canonicalize_key(input: &str) -> Result<String, Response> {
    let key = input.trim().to_lowercase();
    if key.is_empty() {
        Err(JsonResponse::bad_request("Section key cannot be empty").into_response())
    } else {
        Ok(key)
    }
}

async fn ensure_workspace_membership(
    app_state: &AppState,
    user_id: Uuid,
    workspace_id: Uuid,
) -> Result<WorkspaceRole, Response> {
    let memberships = app_state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await
        .map_err(|err| {
            eprintln!(
                "Failed to load memberships while checking workspace access: {:?}",
                err
            );
            JsonResponse::server_error("Failed to load workspace access").into_response()
        })?;

    memberships
        .into_iter()
        .find(|membership| membership.workspace.id == workspace_id)
        .map(|membership| membership.role)
        .ok_or_else(|| JsonResponse::forbidden("Workspace membership required").into_response())
}

async fn collect_workspace_secrets(
    app_state: &AppState,
    workspace_id: Uuid,
) -> Result<SecretResponseStore, Response> {
    let members = app_state
        .workspace_repo
        .list_members(workspace_id)
        .await
        .map_err(|err| {
            eprintln!(
                "Failed to list workspace members while loading secrets: {:?}",
                err
            );
            JsonResponse::server_error("Failed to load workspace secrets").into_response()
        })?;

    let mut aggregate = SecretResponseStore::new();

    for member in members {
        let settings = app_state
            .db
            .get_user_settings(member.user_id)
            .await
            .map_err(|err| {
                eprintln!(
                    "Failed to load user settings for workspace secrets (member: {}): {:?}",
                    member.user_id, err
                );
                JsonResponse::server_error("Failed to load workspace secrets").into_response()
            })?;

        let store = read_secret_store(&settings);
        extend_response_store(&mut aggregate, &store, member.user_id);
    }

    Ok(aggregate)
}

pub async fn list_secrets(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Query(params): Query<SecretsQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    if let Some(workspace_id) = params.workspace {
        if let Err(resp) = ensure_workspace_membership(&app_state, user_id, workspace_id).await {
            return resp;
        }

        let secrets = match collect_workspace_secrets(&app_state, workspace_id).await {
            Ok(store) => serde_json::to_value(store).unwrap_or_else(|_| json!({})),
            Err(resp) => return resp,
        };

        return (
            StatusCode::OK,
            Json(json!({ "success": true, "secrets": secrets })),
        )
            .into_response();
    }

    let settings = match app_state.db.get_user_settings(user_id).await {
        Ok(settings) => settings,
        Err(e) => {
            eprintln!("Failed to load user settings: {:?}", e);
            return JsonResponse::server_error("Failed to load secrets").into_response();
        }
    };

    let store = read_secret_store(&settings);
    let secrets =
        serde_json::to_value(to_response_store(&store, user_id)).unwrap_or_else(|_| json!({}));

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
    Query(params): Query<SecretsQuery>,
    Json(payload): Json<SecretPayload>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let mut workspace_context: Option<(Uuid, WorkspaceRole)> = None;
    if let Some(workspace_id) = params.workspace {
        match ensure_workspace_membership(&app_state, user_id, workspace_id).await {
            Ok(role) => {
                if role == WorkspaceRole::Viewer {
                    return JsonResponse::forbidden(
                        "You do not have permission to create secrets for this workspace",
                    )
                    .into_response();
                }
                workspace_context = Some((workspace_id, role));
            }
            Err(resp) => return resp,
        }
    }

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

    if let Some((workspace_id, _role)) = workspace_context {
        let secrets = match collect_workspace_secrets(&app_state, workspace_id).await {
            Ok(store) => serde_json::to_value(store).unwrap_or_else(|_| json!({})),
            Err(resp) => return resp,
        };

        return (
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
            .into_response();
    }

    let secrets =
        serde_json::to_value(to_response_store(&store, user_id)).unwrap_or_else(|_| json!({}));
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
    Query(params): Query<SecretsQuery>,
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

    if let Some(workspace_id) = params.workspace {
        let role = match ensure_workspace_membership(&app_state, user_id, workspace_id).await {
            Ok(role) => role,
            Err(resp) => return resp,
        };

        let members = match app_state.workspace_repo.list_members(workspace_id).await {
            Ok(members) => members,
            Err(err) => {
                eprintln!(
                    "Failed to list workspace members while deleting secret: {:?}",
                    err
                );
                return JsonResponse::server_error("Failed to delete secret").into_response();
            }
        };

        let mut matched_owner: Option<Uuid> = None;
        let mut owner_settings = None;
        let mut owner_store = None;

        for member in members {
            let settings = match app_state.db.get_user_settings(member.user_id).await {
                Ok(settings) => settings,
                Err(err) => {
                    eprintln!(
                        "Failed to load user settings while deleting workspace secret (member: {}): {:?}",
                        member.user_id,
                        err
                    );
                    return JsonResponse::server_error("Failed to delete secret").into_response();
                }
            };

            let mut store = read_secret_store(&settings);
            if remove_named_secret(&mut store, &group_key, &service_key, &name) {
                matched_owner = Some(member.user_id);
                owner_settings = Some(settings);
                owner_store = Some(store);
                break;
            }
        }

        let Some(owner_id) = matched_owner else {
            return JsonResponse::not_found("Secret not found").into_response();
        };

        let mut settings = owner_settings.expect("settings captured with owner");
        let store = owner_store.expect("store captured with owner");

        let is_admin = matches!(role, WorkspaceRole::Owner | WorkspaceRole::Admin);
        if owner_id != user_id && !is_admin {
            return JsonResponse::forbidden(
                "Only the creator or a workspace admin can delete this secret",
            )
            .into_response();
        }

        write_secret_store(&mut settings, &store);
        if let Err(err) = app_state.db.update_user_settings(owner_id, settings).await {
            eprintln!(
                "Failed to persist workspace secrets after deletion (owner: {}): {:?}",
                owner_id, err
            );
            return JsonResponse::server_error("Failed to delete secret").into_response();
        }

        let secrets = match collect_workspace_secrets(&app_state, workspace_id).await {
            Ok(store) => serde_json::to_value(store).unwrap_or_else(|_| json!({})),
            Err(resp) => return resp,
        };

        return (
            StatusCode::OK,
            Json(json!({ "success": true, "secrets": secrets })),
        )
            .into_response();
    }

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

    let secrets =
        serde_json::to_value(to_response_store(&store, user_id)).unwrap_or_else(|_| json!({}));
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
