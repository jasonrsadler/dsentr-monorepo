use super::{
    helpers::{
        default_provider_statuses, map_oauth_error, parse_provider, provider_to_key,
        ConnectionsResponse, RefreshResponse,
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

    match state.oauth_accounts.list_tokens(user_id).await {
        Ok(tokens) => {
            let mut providers = default_provider_statuses();

            for token in tokens {
                let key = provider_to_key(token.provider);
                if let Some(entry) = providers.get_mut(key) {
                    entry.connected = true;
                    entry.account_email = Some(token.account_email);
                    entry.expires_at = Some(token.expires_at);
                }
            }

            Json(ConnectionsResponse {
                success: true,
                providers,
            })
            .into_response()
        }
        Err(OAuthAccountError::NotFound) => Json(ConnectionsResponse {
            success: true,
            providers: default_provider_statuses(),
        })
        .into_response(),
        Err(err) => map_oauth_error(err),
    }
}
