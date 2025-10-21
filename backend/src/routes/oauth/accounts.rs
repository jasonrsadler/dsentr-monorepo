use super::{
    helpers::{
        map_oauth_error, parse_provider, ConnectionsResponse, PersonalConnectionPayload,
        RefreshResponse, WorkspaceConnectionPayload,
    },
    prelude::*,
};
use axum::http::StatusCode;

#[derive(Debug, Default, Deserialize)]
pub struct ListConnectionsQuery {
    #[serde(default)]
    pub workspace: Option<Uuid>,
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
            last_refreshed_at: token.updated_at,
            requires_reconnect: false,
        })
        .collect();

    let workspace = if let Some(workspace_id) = params.workspace {
        workspace_connections
            .into_iter()
            .filter(|connection| connection.workspace_id == workspace_id)
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
                    last_refreshed_at: connection.updated_at,
                    requires_reconnect: connection.requires_reconnect,
                }
            })
            .collect()
    } else {
        Vec::new()
    };

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
