use super::{
    helpers::{
        map_oauth_error, parse_provider, ConnectionOwnerPayload, ConnectionsResponse,
        PersonalConnectionPayload, ProviderGroupedConnections, RefreshResponse,
        WorkspaceConnectionPayload, OAUTH_PLAN_RESTRICTION_MESSAGE,
    },
    prelude::*,
};
use axum::http::StatusCode;

async fn ensure_workspace_membership(
    app_state: &AppState,
    user_id: Uuid,
    workspace_id: Uuid,
) -> Result<(), Response> {
    let memberships = app_state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await
        .map_err(|err| {
            error!(?err, user_id = %user_id, workspace_id = %workspace_id, "Failed to load memberships while checking workspace access");
            JsonResponse::server_error("Failed to load workspace access").into_response()
        })?;

    let membership = match memberships
        .into_iter()
        .find(|membership| membership.workspace.id == workspace_id)
    {
        Some(membership) => membership,
        None => {
            return Err(JsonResponse::forbidden("Workspace membership required").into_response())
        }
    };

    let plan_tier = NormalizedPlanTier::from_option(Some(membership.workspace.plan.as_str()));
    if plan_tier.is_solo() {
        return Err(JsonResponse::forbidden_with_code(
            OAUTH_PLAN_RESTRICTION_MESSAGE,
            "workspace_plan_required",
        )
        .into_response());
    }

    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ListConnectionsQuery {
    pub workspace: Uuid,
}

pub async fn refresh_connection(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(provider): Path<String>,
) -> Response {
    let provider = match parse_provider(&provider) {
        Some(p) => p,
        None => {
            return JsonResponse::bad_request("Unknown provider").into_response();
        }
    };

    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::server_error("Invalid user identifier").into_response(),
    };

    match state
        .oauth_accounts
        .ensure_valid_access_token(user_id, provider)
        .await
    {
        Ok(token) => Json(RefreshResponse {
            success: true,
            requires_reconnect: false,
            account_email: Some(token.account_email),
            expires_at: Some(token.expires_at),
            last_refreshed_at: Some(token.updated_at),
            message: None,
        })
        .into_response(),
        Err(OAuthAccountError::TokenRevoked { .. }) => (
            StatusCode::CONFLICT,
            Json(RefreshResponse {
                success: false,
                requires_reconnect: true,
                account_email: None,
                expires_at: None,
                last_refreshed_at: None,
                message: Some(
                    "The OAuth connection was revoked. Reconnect to restore access.".to_string(),
                ),
            }),
        )
            .into_response(),
        Err(err) => map_oauth_error(err),
    }
}

pub async fn disconnect_connection(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(provider): Path<String>,
) -> Response {
    let provider = match parse_provider(&provider) {
        Some(p) => p,
        None => {
            return JsonResponse::bad_request("Unknown provider").into_response();
        }
    };
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::server_error("Invalid user identifier").into_response(),
    };

    match state.oauth_accounts.delete_tokens(user_id, provider).await {
        Ok(()) => JsonResponse::success("Disconnected").into_response(),
        Err(err) => map_oauth_error(err),
    }
}

pub async fn list_connections(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Query(params): Query<ListConnectionsQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::server_error("Invalid user identifier").into_response(),
    };

    // Enforce workspace membership up-front
    if let Err(resp) = ensure_workspace_membership(&state, user_id, params.workspace).await {
        return resp;
    }

    let personal_tokens = match state.oauth_accounts.list_tokens(user_id).await {
        Ok(tokens) => tokens,
        Err(OAuthAccountError::NotFound) => Vec::new(),
        Err(err) => return map_oauth_error(err),
    };

    // Assert that all personal tokens are owned by the authenticated user
    if let Err(err) = state
        .oauth_accounts
        .assert_personal_tokens_owned_by(user_id, &personal_tokens)
        .await
    {
        error!(user_id = %user_id, ?err, "Personal OAuth token ownership assertion failed");
        return JsonResponse::forbidden("Access to OAuth credentials is forbidden").into_response();
    }

    let workspace_connections = match state
        .workspace_connection_repo
        .list_for_workspace(params.workspace)
        .await
    {
        Ok(connections) => connections,
        Err(err) => {
            error!(workspace_id = %params.workspace, ?err, "Failed to load workspace OAuth connections");
            return JsonResponse::server_error("Failed to load workspace connections")
                .into_response();
        }
    };

    // Defensive assertion: all entries must match the requested workspace
    let all_match = workspace_connections
        .iter()
        .all(|c| c.workspace_id == params.workspace);
    if !all_match {
        error!(workspace_id = %params.workspace, "Workspace OAuth listing contained entries for a different workspace");
        return JsonResponse::forbidden("Access to workspace credentials is forbidden")
            .into_response();
    }

    let personal_owner = ConnectionOwnerPayload {
        user_id,
        name: format_shared_name(
            &Some(claims.first_name.clone()),
            &Some(claims.last_name.clone()),
        ),
        email: normalize_optional_field(&claims.email),
    };

    let mut personal = ProviderGroupedConnections::default();
    for token in personal_tokens {
        personal.push(
            token.provider,
            PersonalConnectionPayload {
                id: token.id,
                provider: token.provider,
                account_email: token.account_email,
                expires_at: token.expires_at,
                is_shared: token.is_shared,
                last_refreshed_at: token.updated_at,
                requires_reconnect: false,
                owner: personal_owner.clone(),
            },
        );
    }

    let mut workspace = ProviderGroupedConnections::default();
    for connection in workspace_connections {
        let shared_by_name = format_shared_name(
            &connection.shared_by_first_name,
            &connection.shared_by_last_name,
        );
        let shared_by_email =
            normalize_optional_field(connection.shared_by_email.as_deref().unwrap_or_default());
        let owner = ConnectionOwnerPayload {
            user_id: connection.owner_user_id,
            name: shared_by_name.clone(),
            email: shared_by_email.clone(),
        };

        workspace.push(
            connection.provider,
            WorkspaceConnectionPayload {
                id: connection.id,
                provider: connection.provider,
                account_email: connection.account_email,
                expires_at: connection.expires_at,
                workspace_id: connection.workspace_id,
                workspace_name: connection.workspace_name,
                shared_by_name,
                shared_by_email,
                last_refreshed_at: connection.updated_at,
                requires_reconnect: connection.requires_reconnect,
                owner,
            },
        );
    }

    Json(ConnectionsResponse {
        success: true,
        personal,
        workspace,
    })
    .into_response()
}

fn format_shared_name(first: &Option<String>, last: &Option<String>) -> Option<String> {
    let first = first
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let last = last
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());

    match (first, last) {
        (None, None) => None,
        (Some(first), None) => Some(first.to_string()),
        (None, Some(last)) => Some(last.to_string()),
        (Some(first), Some(last)) => Some(format!("{} {}", first, last)),
    }
}

fn normalize_optional_field(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized.to_string())
}
