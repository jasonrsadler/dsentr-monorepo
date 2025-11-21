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
        SecretResponseStore, SecretStore, SecretStoreRead, SecretUpsertOutcome,
        SecretValidationError,
    },
};

#[derive(Deserialize)]
pub struct SecretPayload {
    value: String,
}

#[derive(Default, Deserialize)]
pub struct SecretsQuery {
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

fn secret_key(app_state: &AppState) -> &[u8] {
    &app_state.config.api_secrets_encryption_key
}

#[allow(clippy::result_large_err)]
fn decrypt_secret_store(
    app_state: &AppState,
    settings: &serde_json::Value,
    log_context: &str,
    client_error: &str,
) -> Result<(SecretStore, SecretStoreRead), Response> {
    read_secret_store(settings, secret_key(app_state)).map_err(|err| {
        eprintln!("{log_context}: {:?}", err);
        JsonResponse::server_error(client_error).into_response()
    })
}

async fn persist_secret_store(
    app_state: &AppState,
    user_id: Uuid,
    mut settings: serde_json::Value,
    store: &SecretStore,
    log_context: &str,
    client_error: &str,
) -> Result<(), Response> {
    write_secret_store(&mut settings, store, secret_key(app_state)).map_err(|err| {
        eprintln!("{log_context}: {:?}", err);
        JsonResponse::server_error(client_error).into_response()
    })?;

    app_state
        .db
        .update_user_settings(user_id, settings)
        .await
        .map_err(|err| {
            eprintln!("{log_context}: {:?}", err);
            JsonResponse::server_error(client_error).into_response()
        })
}

async fn persist_if_needed(
    app_state: &AppState,
    user_id: Uuid,
    settings: serde_json::Value,
    store: &SecretStore,
    hint: SecretStoreRead,
    log_context: &str,
    client_error: &str,
) -> Result<(), Response> {
    if !hint.needs_rewrite {
        return Ok(());
    }

    persist_secret_store(
        app_state,
        user_id,
        settings,
        store,
        log_context,
        client_error,
    )
    .await
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

        let (store, hint) = decrypt_secret_store(
            app_state,
            &settings,
            "Failed to decrypt workspace secrets",
            "Failed to load workspace secrets",
        )?;

        persist_if_needed(
            app_state,
            member.user_id,
            settings,
            &store,
            hint,
            "Failed to persist encrypted workspace secrets",
            "Failed to load workspace secrets",
        )
        .await?;

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

    let (store, hint) = match decrypt_secret_store(
        &app_state,
        &settings,
        "Failed to decrypt user secrets",
        "Failed to load secrets",
    ) {
        Ok(result) => result,
        Err(resp) => return resp,
    };

    if let Err(resp) = persist_if_needed(
        &app_state,
        user_id,
        settings,
        &store,
        hint,
        "Failed to re-encrypt user secrets",
        "Failed to load secrets",
    )
    .await
    {
        return resp;
    }

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

    let settings = match app_state.db.get_user_settings(user_id).await {
        Ok(settings) => settings,
        Err(e) => {
            eprintln!("Failed to load user settings: {:?}", e);
            return JsonResponse::server_error("Failed to load secrets").into_response();
        }
    };

    let (mut store, _) = match decrypt_secret_store(
        &app_state,
        &settings,
        "Failed to decrypt user secrets while saving",
        "Failed to save secret",
    ) {
        Ok(result) => result,
        Err(resp) => return resp,
    };
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

    if let Err(resp) = persist_secret_store(
        &app_state,
        user_id,
        settings,
        &store,
        "Failed to persist encrypted user secrets",
        "Failed to save secret",
    )
    .await
    {
        return resp;
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

            let (mut store, hint) = match decrypt_secret_store(
                &app_state,
                &settings,
                "Failed to decrypt workspace secrets while deleting",
                "Failed to delete secret",
            ) {
                Ok(result) => result,
                Err(resp) => return resp,
            };

            if remove_named_secret(&mut store, &group_key, &service_key, &name) {
                matched_owner = Some(member.user_id);
                owner_settings = Some((settings, store));
                break;
            }

            if let Err(resp) = persist_if_needed(
                &app_state,
                member.user_id,
                settings,
                &store,
                hint,
                "Failed to refresh workspace secret encryption",
                "Failed to delete secret",
            )
            .await
            {
                return resp;
            }
        }

        let Some(owner_id) = matched_owner else {
            return JsonResponse::not_found("Secret not found").into_response();
        };

        let (settings, store) = owner_settings.expect("settings captured with owner");

        let is_admin = matches!(role, WorkspaceRole::Owner | WorkspaceRole::Admin);
        if owner_id != user_id && !is_admin {
            return JsonResponse::forbidden(
                "Only the creator or a workspace admin can delete this secret",
            )
            .into_response();
        }

        if let Err(resp) = persist_secret_store(
            &app_state,
            owner_id,
            settings,
            &store,
            "Failed to persist workspace secrets after deletion",
            "Failed to delete secret",
        )
        .await
        {
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

    let (mut store, hint) = match decrypt_secret_store(
        &app_state,
        &settings,
        "Failed to decrypt user secrets while deleting",
        "Failed to delete secret",
    ) {
        Ok(result) => result,
        Err(resp) => return resp,
    };

    let removed = remove_named_secret(&mut store, &group_key, &service_key, &name);
    if !removed {
        if let Err(resp) = persist_if_needed(
            &app_state,
            user_id,
            settings,
            &store,
            hint,
            "Failed to refresh user secret encryption",
            "Failed to delete secret",
        )
        .await
        {
            return resp;
        }
        return JsonResponse::not_found("Secret not found").into_response();
    }

    if let Err(resp) = persist_secret_store(
        &app_state,
        user_id,
        settings,
        &store,
        "Failed to persist user secrets after deletion",
        "Failed to delete secret",
    )
    .await
    {
        return resp;
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
    let Ok(settings) = app_state.db.get_user_settings(user_id).await else {
        return;
    };
    let Ok((mut store, hint)) = read_secret_store(&settings, secret_key(app_state)) else {
        eprintln!(
            "Failed to decrypt secrets while syncing from workflow (user: {})",
            user_id
        );
        return;
    };
    let mut changed = hint.needs_rewrite;
    for (group, service, value) in collect_workflow_secrets(workflow_data) {
        if ensure_secret_exists(&mut store, &group, &service, &value) {
            changed = true;
        }
    }
    if changed {
        let mut settings = settings;
        if let Err(err) = write_secret_store(&mut settings, &store, secret_key(app_state)) {
            eprintln!(
                "Failed to encrypt secrets while syncing workflow (user: {}): {:?}",
                user_id, err
            );
            return;
        }
        if let Err(e) = app_state.db.update_user_settings(user_id, settings).await {
            eprintln!("Failed to sync workflow secrets: {:?}", e);
        }
    }
}
