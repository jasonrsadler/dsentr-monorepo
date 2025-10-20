use super::{
    helpers::{
        map_oauth_error, parse_provider, ConnectionsResponse, PersonalConnectionPayload,
        RefreshResponse, WorkspaceConnectionPayload,
    },
    prelude::*,
};

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
            account_email: token.account_email,
            expires_at: token.expires_at,
        })
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
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::server_error("Invalid user identifier").into_response(),
    };

    let personal_tokens = match state.oauth_accounts.list_tokens(user_id).await {
        Ok(tokens) => tokens,
        Err(OAuthAccountError::NotFound) => Vec::new(),
        Err(err) => return map_oauth_error(err),
    };

    let workspace_connections = match state
        .workspace_connection_repo
        .list_for_user_memberships(user_id)
        .await
    {
        Ok(connections) => connections,
        Err(err) => {
            error!(?err, "Failed to load workspace OAuth connections");
            return JsonResponse::server_error("Failed to load workspace connections")
                .into_response();
        }
    };

    let personal = personal_tokens
        .into_iter()
        .map(|token| PersonalConnectionPayload {
            id: token.id,
            provider: token.provider,
            account_email: token.account_email,
            expires_at: token.expires_at,
            is_shared: token.is_shared,
        })
        .collect();

    let workspace = workspace_connections
        .into_iter()
        .map(|connection| {
            let shared_by_name = format_shared_name(
                &connection.shared_by_first_name,
                &connection.shared_by_last_name,
            );
            let shared_by_email = connection
                .shared_by_email
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string());

            WorkspaceConnectionPayload {
                id: connection.id,
                provider: connection.provider,
                account_email: connection.account_email,
                expires_at: connection.expires_at,
                workspace_id: connection.workspace_id,
                workspace_name: connection.workspace_name,
                shared_by_name,
                shared_by_email,
            }
        })
        .collect();

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
