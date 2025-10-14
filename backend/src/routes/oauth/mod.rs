use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Redirect, Response},
    Json,
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use reqwest::Url;
use serde::Deserialize;
use serde::Serialize;
use time::{Duration, OffsetDateTime};
use tracing::error;
use urlencoding::encode;
use uuid::Uuid;

use crate::config::Config;
use crate::models::oauth_token::ConnectedOAuthProvider;
use crate::responses::JsonResponse;
use crate::routes::auth::session::AuthSession;
use crate::services::oauth::account_service::OAuthAccountError;
use crate::state::AppState;
use crate::utils::csrf::generate_csrf_token;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const MICROSOFT_AUTH_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const GOOGLE_STATE_COOKIE: &str = "oauth_google_state";
const MICROSOFT_STATE_COOKIE: &str = "oauth_microsoft_state";
const STATE_COOKIE_MAX_MINUTES: i64 = 10;

#[derive(Deserialize)]
pub(crate) struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Serialize)]
struct ProviderStatus {
    connected: bool,
    account_email: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    expires_at: Option<OffsetDateTime>,
}

#[derive(Serialize)]
struct ConnectionsResponse {
    success: bool,
    providers: HashMap<String, ProviderStatus>,
}

#[derive(Serialize)]
struct RefreshResponse {
    success: bool,
    account_email: String,
    #[serde(with = "time::serde::rfc3339")]
    expires_at: OffsetDateTime,
}

pub async fn google_connect_start(
    State(state): State<AppState>,
    _session: AuthSession,
    jar: CookieJar,
) -> Response {
    let state_token = generate_csrf_token();
    let cookie = build_state_cookie(GOOGLE_STATE_COOKIE, &state_token);
    let jar = jar.add(cookie);

    let mut url = Url::parse(GOOGLE_AUTH_URL).expect("valid google auth url");
    url.query_pairs_mut()
        .append_pair("client_id", &state.config.oauth.google.client_id)
        .append_pair("redirect_uri", &state.config.oauth.google.redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", state.oauth_accounts.google_scopes())
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", &state_token);

    (jar, Redirect::to(url.as_str())).into_response()
}

pub async fn google_connect_callback(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    jar: CookieJar,
    Query(query): Query<CallbackQuery>,
) -> Response {
    handle_callback(
        state,
        claims,
        jar,
        query,
        ConnectedOAuthProvider::Google,
        GOOGLE_STATE_COOKIE,
    )
    .await
}

pub async fn microsoft_connect_start(
    State(state): State<AppState>,
    _session: AuthSession,
    jar: CookieJar,
) -> Response {
    let state_token = generate_csrf_token();
    let cookie = build_state_cookie(MICROSOFT_STATE_COOKIE, &state_token);
    let jar = jar.add(cookie);

    let mut url = Url::parse(MICROSOFT_AUTH_URL).expect("valid microsoft auth url");
    url.query_pairs_mut()
        .append_pair("client_id", &state.config.oauth.microsoft.client_id)
        .append_pair("redirect_uri", &state.config.oauth.microsoft.redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", state.oauth_accounts.microsoft_scopes())
        .append_pair("response_mode", "query")
        .append_pair("state", &state_token);

    (jar, Redirect::to(url.as_str())).into_response()
}

pub async fn microsoft_connect_callback(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    jar: CookieJar,
    Query(query): Query<CallbackQuery>,
) -> Response {
    handle_callback(
        state,
        claims,
        jar,
        query,
        ConnectedOAuthProvider::Microsoft,
        MICROSOFT_STATE_COOKIE,
    )
    .await
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

async fn handle_callback(
    state: AppState,
    claims: crate::routes::auth::claims::Claims,
    jar: CookieJar,
    query: CallbackQuery,
    provider: ConnectedOAuthProvider,
    cookie_name: &str,
) -> Response {
    if let Some(error) = query.error.or(query.error_description) {
        return redirect_with_error(&state.config, provider, &error);
    }

    let code = match query.code {
        Some(code) => code,
        None => return redirect_with_error(&state.config, provider, "Missing code"),
    };

    let expected_state = match jar.get(cookie_name) {
        Some(cookie) => cookie.value().to_string(),
        None => return redirect_with_error(&state.config, provider, "Missing state"),
    };

    let provided_state = match query.state {
        Some(state) => state,
        None => return redirect_with_error(&state.config, provider, "Missing state"),
    };

    if provided_state != expected_state {
        return redirect_with_error(&state.config, provider, "Invalid state");
    }

    let jar = clear_state_cookie(jar, cookie_name);

    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return redirect_with_error(&state.config, provider, "Invalid user"),
    };

    let tokens = match state
        .oauth_accounts
        .exchange_authorization_code(provider, &code)
        .await
    {
        Ok(tokens) => tokens,
        Err(err) => {
            error!("OAuth authorization exchange failed: {err}");
            let response =
                redirect_with_error(&state.config, provider, &error_message_for_redirect(&err));
            return (jar, response).into_response();
        }
    };

    if let Err(err) = state
        .oauth_accounts
        .save_authorization(user_id, provider, tokens)
        .await
    {
        error!("Saving OAuth authorization failed: {err}");
        let response =
            redirect_with_error(&state.config, provider, &error_message_for_redirect(&err));
        return (jar, response).into_response();
    }

    (jar, redirect_success(&state.config, provider)).into_response()
}

fn build_state_cookie(name: &str, value: &str) -> Cookie<'static> {
    Cookie::build((name.to_owned(), value.to_owned()))
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(Duration::minutes(STATE_COOKIE_MAX_MINUTES))
        .build()
}

fn clear_state_cookie(jar: CookieJar, name: &str) -> CookieJar {
    let cookie = Cookie::build((name.to_owned(), String::new()))
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(Duration::seconds(0))
        .build();
    jar.add(cookie)
}

fn parse_provider(raw: &str) -> Option<ConnectedOAuthProvider> {
    match raw.to_ascii_lowercase().as_str() {
        "google" => Some(ConnectedOAuthProvider::Google),
        "microsoft" => Some(ConnectedOAuthProvider::Microsoft),
        _ => None,
    }
}

fn provider_to_key(provider: ConnectedOAuthProvider) -> &'static str {
    match provider {
        ConnectedOAuthProvider::Google => "google",
        ConnectedOAuthProvider::Microsoft => "microsoft",
    }
}

fn redirect_success(config: &Config, provider: ConnectedOAuthProvider) -> Redirect {
    let url = format!(
        "{}/dashboard?connected=true&provider={}",
        config.frontend_origin,
        provider_to_key(provider)
    );
    Redirect::to(&url)
}

fn redirect_with_error(
    config: &Config,
    provider: ConnectedOAuthProvider,
    message: &str,
) -> Response {
    let url = format!(
        "{}/dashboard?connected=false&provider={}&error={}",
        config.frontend_origin,
        provider_to_key(provider),
        encode(message)
    );
    Redirect::to(&url).into_response()
}

fn map_oauth_error(err: OAuthAccountError) -> Response {
    match err {
        OAuthAccountError::NotFound => {
            JsonResponse::not_found("No connection found for provider").into_response()
        }
        OAuthAccountError::Database(e) => {
            error!("OAuth database error: {e}");
            JsonResponse::server_error("Failed to persist OAuth tokens").into_response()
        }
        OAuthAccountError::Encryption(e) => {
            error!("OAuth encryption error: {e}");
            JsonResponse::server_error("Token encryption failed").into_response()
        }
        OAuthAccountError::Http(e) => {
            error!("OAuth HTTP error: {e}");
            JsonResponse::server_error("Provider request failed").into_response()
        }
        OAuthAccountError::InvalidResponse(msg) => JsonResponse::server_error(&msg).into_response(),
        OAuthAccountError::MissingRefreshToken => {
            JsonResponse::server_error("Provider did not return a refresh token").into_response()
        }
    }
}

fn error_message_for_redirect(err: &OAuthAccountError) -> String {
    match err {
        OAuthAccountError::NotFound => "Connection not found".to_string(),
        OAuthAccountError::Database(_) => {
            "Could not save OAuth tokens. Please try again.".to_string()
        }
        OAuthAccountError::Encryption(_) => "Could not secure OAuth tokens.".to_string(),
        OAuthAccountError::Http(_) => "The OAuth provider request failed.".to_string(),
        OAuthAccountError::InvalidResponse(_) => {
            "Received an invalid response from the OAuth provider.".to_string()
        }
        OAuthAccountError::MissingRefreshToken => {
            "The OAuth provider did not return a refresh token.".to_string()
        }
    }
}

fn default_provider_statuses() -> HashMap<String, ProviderStatus> {
    HashMap::from([
        (
            "google".to_string(),
            ProviderStatus {
                connected: false,
                account_email: None,
                expires_at: None,
            },
        ),
        (
            "microsoft".to_string(),
            ProviderStatus {
                connected: false,
                account_email: None,
                expires_at: None,
            },
        ),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{header, StatusCode};
    use axum_extra::extract::cookie::CookieJar;
    use std::sync::Arc;

    use crate::config::{Config, OAuthProviderConfig, OAuthSettings};
    use crate::db::mock_db::{MockDb, NoopWorkflowRepository};
    use crate::models::user::UserRole;
    use crate::routes::auth::claims::Claims;
    use crate::services::{
        oauth::{
            account_service::OAuthAccountService, github::mock_github_oauth::MockGitHubOAuth,
            google::mock_google_oauth::MockGoogleOAuth,
        },
        smtp_mailer::MockMailer,
    };
    use crate::state::AppState;

    fn stub_config() -> Arc<Config> {
        Arc::new(Config {
            database_url: "postgres://localhost".into(),
            frontend_origin: "http://localhost:5173".into(),
            oauth: OAuthSettings {
                google: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "http://localhost/google".into(),
                },
                microsoft: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "http://localhost/microsoft".into(),
                },
                token_encryption_key: vec![0u8; 32],
            },
        })
    }

    fn stub_state(config: Arc<Config>) -> AppState {
        AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo: Arc::new(NoopWorkflowRepository::default()),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts: OAuthAccountService::test_stub(),
            http_client: Arc::new(reqwest::Client::new()),
            config,
            worker_id: Arc::new("test-worker".into()),
            worker_lease_seconds: 30,
        }
    }

    fn stub_claims() -> Claims {
        Claims {
            id: uuid::Uuid::new_v4().to_string(),
            email: "user@example.com".into(),
            exp: 0,
            first_name: "Test".into(),
            last_name: "User".into(),
            role: Some(UserRole::User),
            plan: None,
            company_name: None,
        }
    }

    #[test]
    fn parse_provider_handles_known_values() {
        assert_eq!(
            parse_provider("google"),
            Some(ConnectedOAuthProvider::Google)
        );
        assert_eq!(
            parse_provider("microsoft"),
            Some(ConnectedOAuthProvider::Microsoft)
        );
        assert_eq!(parse_provider("unknown"), None);
    }

    #[test]
    fn default_provider_statuses_include_all_providers() {
        let statuses = default_provider_statuses();
        assert!(statuses.contains_key("google"));
        assert!(statuses.contains_key("microsoft"));
        assert!(!statuses["google"].connected);
    }

    #[tokio::test]
    async fn callback_with_mismatched_state_redirects_with_error() {
        let config = stub_config();
        let state = stub_state(config.clone());
        let jar = CookieJar::new().add(build_state_cookie(GOOGLE_STATE_COOKIE, "expected"));
        let query = CallbackQuery {
            code: Some("auth-code".into()),
            state: Some("unexpected".into()),
            error: None,
            error_description: None,
        };

        let response = handle_callback(
            state,
            stub_claims(),
            jar,
            query,
            ConnectedOAuthProvider::Google,
            GOOGLE_STATE_COOKIE,
        )
        .await;

        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        let location = response
            .headers()
            .get(header::LOCATION)
            .expect("location header");
        let location = location.to_str().unwrap();
        assert!(location.contains("connected=false"));
        assert!(location.contains("provider=google"));
    }

    #[test]
    fn redirect_error_messages_are_user_friendly() {
        let msg = error_message_for_redirect(&OAuthAccountError::MissingRefreshToken);
        assert!(msg.contains("refresh token"));
    }
}
