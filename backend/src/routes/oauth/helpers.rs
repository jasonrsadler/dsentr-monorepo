use super::prelude::*;

pub(crate) const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub(crate) const MICROSOFT_AUTH_URL: &str =
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
pub(crate) const SLACK_AUTH_URL: &str = "https://slack.com/oauth/v2/authorize";
pub(crate) const ASANA_AUTH_URL: &str = "https://app.asana.com/-/oauth_authorize";
pub(crate) const GOOGLE_STATE_COOKIE: &str = "oauth_google_state";
pub(crate) const MICROSOFT_STATE_COOKIE: &str = "oauth_microsoft_state";
pub(crate) const SLACK_STATE_COOKIE: &str = "oauth_slack_state";
pub(crate) const ASANA_STATE_COOKIE: &str = "oauth_asana_state";
pub(crate) const STATE_COOKIE_MAX_MINUTES: i64 = 10;
pub(crate) const OAUTH_PLAN_RESTRICTION_MESSAGE: &str =
    "OAuth integrations are available on workspace plans and above. Upgrade to connect accounts.";

#[derive(Deserialize)]
pub struct CallbackQuery {
    pub(crate) code: Option<String>,
    pub(crate) state: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) error_description: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionOwnerPayload {
    pub(crate) user_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) email: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersonalConnectionPayload {
    pub(crate) id: Uuid,
    pub(crate) provider: ConnectedOAuthProvider,
    pub(crate) account_email: String,
    #[serde(with = "time::serde::rfc3339")]
    pub(crate) expires_at: OffsetDateTime,
    pub(crate) is_shared: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub(crate) last_refreshed_at: OffsetDateTime,
    pub(crate) requires_reconnect: bool,
    pub(crate) owner: ConnectionOwnerPayload,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceConnectionPayload {
    pub(crate) id: Uuid,
    pub(crate) provider: ConnectedOAuthProvider,
    pub(crate) account_email: String,
    #[serde(with = "time::serde::rfc3339")]
    pub(crate) expires_at: OffsetDateTime,
    pub(crate) workspace_id: Uuid,
    pub(crate) workspace_name: String,
    pub(crate) shared_by_name: Option<String>,
    pub(crate) shared_by_email: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub(crate) last_refreshed_at: OffsetDateTime,
    pub(crate) requires_reconnect: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) has_incoming_webhook: bool,
    pub(crate) owner: ConnectionOwnerPayload,
}

#[derive(Serialize)]
pub(crate) struct ProviderGroupedConnections<T> {
    pub(crate) google: Vec<T>,
    pub(crate) microsoft: Vec<T>,
    pub(crate) slack: Vec<T>,
    pub(crate) asana: Vec<T>,
}

impl<T> Default for ProviderGroupedConnections<T> {
    fn default() -> Self {
        Self {
            google: Vec::new(),
            microsoft: Vec::new(),
            slack: Vec::new(),
            asana: Vec::new(),
        }
    }
}

impl<T> ProviderGroupedConnections<T> {
    pub(crate) fn push(&mut self, provider: ConnectedOAuthProvider, payload: T) {
        match provider {
            ConnectedOAuthProvider::Google => self.google.push(payload),
            ConnectedOAuthProvider::Microsoft => self.microsoft.push(payload),
            ConnectedOAuthProvider::Slack => self.slack.push(payload),
            ConnectedOAuthProvider::Asana => self.asana.push(payload),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionsResponse {
    pub(crate) success: bool,
    pub(crate) personal: ProviderGroupedConnections<PersonalConnectionPayload>,
    pub(crate) workspace: ProviderGroupedConnections<WorkspaceConnectionPayload>,
}

#[derive(Serialize)]
pub(crate) struct RefreshResponse {
    pub(crate) success: bool,
    pub(crate) requires_reconnect: bool,
    pub(crate) account_email: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub(crate) expires_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub(crate) last_refreshed_at: Option<OffsetDateTime>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) message: Option<String>,
}

pub(crate) async fn handle_callback(
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

pub(crate) fn build_state_cookie(name: &str, value: &str) -> Cookie<'static> {
    Cookie::build((name.to_owned(), value.to_owned()))
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(Duration::minutes(STATE_COOKIE_MAX_MINUTES))
        .build()
}

pub(crate) fn clear_state_cookie(jar: CookieJar, name: &str) -> CookieJar {
    let cookie = Cookie::build((name.to_owned(), String::new()))
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(Duration::seconds(0))
        .build();
    jar.add(cookie)
}

pub(crate) fn parse_provider(raw: &str) -> Option<ConnectedOAuthProvider> {
    match raw.to_ascii_lowercase().as_str() {
        "google" => Some(ConnectedOAuthProvider::Google),
        "microsoft" => Some(ConnectedOAuthProvider::Microsoft),
        "slack" => Some(ConnectedOAuthProvider::Slack),
        "asana" => Some(ConnectedOAuthProvider::Asana),
        _ => None,
    }
}

pub(crate) fn provider_to_key(provider: ConnectedOAuthProvider) -> &'static str {
    match provider {
        ConnectedOAuthProvider::Google => "google",
        ConnectedOAuthProvider::Microsoft => "microsoft",
        ConnectedOAuthProvider::Slack => "slack",
        ConnectedOAuthProvider::Asana => "asana",
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

pub(crate) fn redirect_with_error(
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

pub fn map_oauth_error(err: OAuthAccountError) -> Response {
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
        OAuthAccountError::EmailNotVerified { provider } => {
            let provider_name = match provider {
                ConnectedOAuthProvider::Google => "Google",
                ConnectedOAuthProvider::Microsoft => "Microsoft",
                ConnectedOAuthProvider::Slack => "Slack",
                ConnectedOAuthProvider::Asana => "Asana",
            };
            JsonResponse::bad_request(&format!(
                "The {provider_name} account email must be verified before connecting."
            ))
            .into_response()
        }
        OAuthAccountError::TokenRevoked { .. } => {
            JsonResponse::conflict("The OAuth connection was revoked. Reconnect to restore access.")
                .into_response()
        }
        OAuthAccountError::InvalidResponse(msg) => JsonResponse::server_error(&msg).into_response(),
        OAuthAccountError::MissingRefreshToken => {
            JsonResponse::server_error("Provider did not return a refresh token").into_response()
        }
    }
}

pub(crate) fn error_message_for_redirect(err: &OAuthAccountError) -> String {
    match err {
        OAuthAccountError::NotFound => "Connection not found".to_string(),
        OAuthAccountError::Database(_) => {
            "Could not save OAuth tokens. Please try again.".to_string()
        }
        OAuthAccountError::Encryption(_) => "Could not secure OAuth tokens.".to_string(),
        OAuthAccountError::Http(_) => "The OAuth provider request failed.".to_string(),
        OAuthAccountError::EmailNotVerified { .. } => {
            "The OAuth account's email address must be verified before connecting.".to_string()
        }
        OAuthAccountError::InvalidResponse(_) => {
            "Received an invalid response from the OAuth provider.".to_string()
        }
        OAuthAccountError::TokenRevoked { .. } => {
            "The OAuth connection was revoked. Reconnect to continue.".to_string()
        }
        OAuthAccountError::MissingRefreshToken => {
            "The OAuth provider did not return a refresh token.".to_string()
        }
    }
}
