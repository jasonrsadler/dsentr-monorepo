use super::{
    helpers::{
        build_slack_state, build_state_cookie, clear_state_cookie, error_message_for_redirect,
        handle_callback, parse_slack_state, redirect_success_with_workspace, redirect_with_error,
        redirect_with_error_for_provider, redirect_with_error_with_workspace, CallbackQuery,
        ASANA_AUTH_URL, ASANA_STATE_COOKIE, GOOGLE_AUTH_URL, GOOGLE_STATE_COOKIE,
        MICROSOFT_AUTH_URL, MICROSOFT_STATE_COOKIE, OAUTH_PLAN_RESTRICTION_MESSAGE, SLACK_AUTH_URL,
        SLACK_STATE_COOKIE, SLACK_WORKSPACE_REQUIRED_MESSAGE,
    },
    prelude::*,
};
use crate::models::workspace::WorkspaceRole;
use crate::services::oauth::workspace_service::WorkspaceOAuthError;
use tracing::{info, warn};

#[derive(Debug, Default, Deserialize)]
pub struct ConnectQuery {
    #[serde(default)]
    pub workspace: Option<Uuid>,
    #[serde(
        default,
        rename = "workspaceConnectionId",
        alias = "workspace_connection_id"
    )]
    pub workspace_connection_id: Option<Uuid>,
}

const OAUTH_VIEWER_RESTRICTION_MESSAGE: &str =
    "Workspace viewers cannot connect OAuth accounts for this workspace.";
const OAUTH_WORKSPACE_ACCESS_ERROR_MESSAGE: &str =
    "We couldn't verify your access to this workspace. Please try again.";

async fn ensure_oauth_permissions(
    state: &AppState,
    user_id: Uuid,
    claims_plan: Option<&str>,
    workspace: Option<Uuid>,
    provider: ConnectedOAuthProvider,
) -> Result<(), Response> {
    if let Some(workspace_id) = workspace {
        match state
            .workspace_repo
            .list_memberships_for_user(user_id)
            .await
        {
            Ok(memberships) => {
                if let Some(membership) = memberships
                    .into_iter()
                    .find(|m| m.workspace.id == workspace_id)
                {
                    if matches!(membership.role, WorkspaceRole::Viewer) {
                        return Err(redirect_with_error_for_provider(
                            &state.config,
                            provider,
                            OAUTH_VIEWER_RESTRICTION_MESSAGE,
                            Some(workspace_id),
                        ));
                    }

                    let plan_tier =
                        NormalizedPlanTier::from_option(Some(membership.workspace.plan.as_str()));
                    if plan_tier.is_solo() {
                        return Err(redirect_with_error_for_provider(
                            &state.config,
                            provider,
                            OAUTH_PLAN_RESTRICTION_MESSAGE,
                            Some(workspace_id),
                        ));
                    }

                    return Ok(());
                }

                return Err(redirect_with_error_for_provider(
                    &state.config,
                    provider,
                    "You do not have access to this workspace.",
                    Some(workspace_id),
                ));
            }
            Err(err) => {
                error!(%user_id, %workspace_id, ?err, "failed to load workspace memberships");
                return Err(redirect_with_error_for_provider(
                    &state.config,
                    provider,
                    OAUTH_WORKSPACE_ACCESS_ERROR_MESSAGE,
                    Some(workspace_id),
                ));
            }
        }
    }

    let plan_tier = state.resolve_plan_tier(user_id, claims_plan).await;
    if plan_tier.is_solo() {
        return Err(redirect_with_error_for_provider(
            &state.config,
            provider,
            OAUTH_PLAN_RESTRICTION_MESSAGE,
            None,
        ));
    }

    Ok(())
}

pub async fn google_connect_start(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Query(params): Query<ConnectQuery>,
    jar: CookieJar,
) -> Response {
    match Uuid::parse_str(&claims.id) {
        Ok(user_id) => {
            if let Err(response) = ensure_oauth_permissions(
                &state,
                user_id,
                claims.plan.as_deref(),
                params.workspace,
                ConnectedOAuthProvider::Google,
            )
            .await
            {
                return response;
            }
        }
        Err(_) => {
            let plan_tier = NormalizedPlanTier::from_option(claims.plan.as_deref());
            if plan_tier.is_solo() {
                return redirect_with_error(
                    &state.config,
                    ConnectedOAuthProvider::Google,
                    OAUTH_PLAN_RESTRICTION_MESSAGE,
                );
            }
        }
    }

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
    AuthSession(claims): AuthSession,
    Query(params): Query<ConnectQuery>,
    jar: CookieJar,
) -> Response {
    match Uuid::parse_str(&claims.id) {
        Ok(user_id) => {
            if let Err(response) = ensure_oauth_permissions(
                &state,
                user_id,
                claims.plan.as_deref(),
                params.workspace,
                ConnectedOAuthProvider::Microsoft,
            )
            .await
            {
                return response;
            }
        }
        Err(_) => {
            let plan_tier = NormalizedPlanTier::from_option(claims.plan.as_deref());
            if plan_tier.is_solo() {
                return redirect_with_error(
                    &state.config,
                    ConnectedOAuthProvider::Microsoft,
                    OAUTH_PLAN_RESTRICTION_MESSAGE,
                );
            }
        }
    }

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

pub async fn slack_connect_start(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Query(params): Query<ConnectQuery>,
    jar: CookieJar,
) -> Response {
    let workspace_id = match params.workspace {
        Some(workspace_id) => workspace_id,
        None => {
            return redirect_with_error_for_provider(
                &state.config,
                ConnectedOAuthProvider::Slack,
                SLACK_WORKSPACE_REQUIRED_MESSAGE,
                None,
            );
        }
    };

    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(user_id) => user_id,
        Err(_) => {
            return redirect_with_error_with_workspace(
                &state.config,
                ConnectedOAuthProvider::Slack,
                "Invalid user",
                Some(workspace_id),
            );
        }
    };

    if let Err(response) = ensure_oauth_permissions(
        &state,
        user_id,
        claims.plan.as_deref(),
        Some(workspace_id),
        ConnectedOAuthProvider::Slack,
    )
    .await
    {
        return response;
    }

    let state_token = build_slack_state(workspace_id);
    let cookie = build_state_cookie(SLACK_STATE_COOKIE, &state_token);
    let jar = jar.add(cookie);

    let bot_scopes = state.oauth_accounts.slack_bot_scopes();
    let user_scopes = state.oauth_accounts.slack_scopes();
    let personal_team_id = if let Some(workspace_connection_id) = params.workspace_connection_id {
        let connection = match state
            .workspace_connection_repo
            .find_by_id(workspace_connection_id)
            .await
        {
            Ok(Some(connection)) => connection,
            Ok(None) => {
                return redirect_with_error_for_provider(
                    &state.config,
                    ConnectedOAuthProvider::Slack,
                    "Slack personal authorization requires a workspace Slack connection.",
                    Some(workspace_id),
                );
            }
            Err(err) => {
                error!(
                    %workspace_id,
                    %workspace_connection_id,
                    ?err,
                    "failed to load workspace connection for Slack personal OAuth"
                );
                return redirect_with_error_for_provider(
                    &state.config,
                    ConnectedOAuthProvider::Slack,
                    OAUTH_WORKSPACE_ACCESS_ERROR_MESSAGE,
                    Some(workspace_id),
                );
            }
        };

        if connection.workspace_id != workspace_id
            || connection.provider != ConnectedOAuthProvider::Slack
        {
            return redirect_with_error_for_provider(
                &state.config,
                ConnectedOAuthProvider::Slack,
                "Slack personal authorization requires a workspace Slack connection.",
                Some(workspace_id),
            );
        }

        let team_id = connection
            .slack_team_id
            .as_deref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());

        match team_id {
            Some(team_id) => Some(team_id),
            None => {
                return redirect_with_error_for_provider(
                    &state.config,
                    ConnectedOAuthProvider::Slack,
                    "Slack personal authorization requires a workspace Slack connection.",
                    Some(workspace_id),
                );
            }
        }
    } else {
        None
    };

    if personal_team_id.is_some() {
        info!(
            provider = "slack",
            workspace_id = %workspace_id,
            user_scopes,
            "Starting Slack personal OAuth authorization"
        );
    } else {
        info!(
            provider = "slack",
            workspace_id = %workspace_id,
            bot_scopes,
            user_scopes,
            "Starting Slack OAuth install with requested scopes"
        );
    }

    let mut url = Url::parse(SLACK_AUTH_URL).expect("valid slack auth url");
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("client_id", &state.config.oauth.slack.client_id)
            .append_pair("redirect_uri", &state.config.oauth.slack.redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("state", &state_token);

        if let Some(team_id) = personal_team_id {
            // Slack reuses existing grants; prompt=consent forces the user OAuth screen.
            query
                .append_pair("user_scope", user_scopes)
                .append_pair("team", &team_id)
                .append_pair("prompt", "consent");
        } else {
            query
                .append_pair("scope", bot_scopes)
                .append_pair("user_scope", user_scopes);
        }
    }

    (jar, Redirect::to(url.as_str())).into_response()
}

pub async fn slack_connect_callback(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    jar: CookieJar,
    Query(query): Query<CallbackQuery>,
) -> Response {
    let provider = ConnectedOAuthProvider::Slack;
    let workspace_hint = jar
        .get(SLACK_STATE_COOKIE)
        .and_then(|cookie| parse_slack_state(cookie.value()));

    if let Some(error) = query.error.clone().or(query.error_description.clone()) {
        return redirect_with_error_with_workspace(&state.config, provider, &error, workspace_hint);
    }

    let code = match query.code.clone() {
        Some(code) => code,
        None => {
            return redirect_with_error_with_workspace(
                &state.config,
                provider,
                "Missing code",
                workspace_hint,
            );
        }
    };

    let expected_state = match jar.get(SLACK_STATE_COOKIE) {
        Some(cookie) => cookie.value().to_string(),
        None => {
            return redirect_with_error_with_workspace(
                &state.config,
                provider,
                "Missing state",
                workspace_hint,
            );
        }
    };

    let provided_state = match query.state.clone() {
        Some(state) => state,
        None => {
            return redirect_with_error_with_workspace(
                &state.config,
                provider,
                "Missing state",
                workspace_hint,
            );
        }
    };

    if provided_state != expected_state {
        return redirect_with_error_with_workspace(
            &state.config,
            provider,
            "Invalid state",
            workspace_hint,
        );
    }

    let jar = clear_state_cookie(jar, SLACK_STATE_COOKIE);
    let workspace_id = match parse_slack_state(&expected_state) {
        Some(workspace_id) => workspace_id,
        None => {
            let response = redirect_with_error_with_workspace(
                &state.config,
                provider,
                SLACK_WORKSPACE_REQUIRED_MESSAGE,
                None,
            );
            return (jar, response).into_response();
        }
    };

    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => {
            let response = redirect_with_error_with_workspace(
                &state.config,
                provider,
                "Invalid user",
                Some(workspace_id),
            );
            return (jar, response).into_response();
        }
    };

    if let Err(response) = ensure_oauth_permissions(
        &state,
        user_id,
        claims.plan.as_deref(),
        Some(workspace_id),
        provider,
    )
    .await
    {
        return (jar, response).into_response();
    }

    let (personal_tokens, workspace_tokens) = match state
        .oauth_accounts
        .exchange_slack_install_tokens(&code)
        .await
    {
        Ok(tokens) => tokens,
        Err(err) => {
            error!("OAuth authorization exchange failed: {err}");
            let response = redirect_with_error_with_workspace(
                &state.config,
                provider,
                &error_message_for_redirect(&err),
                Some(workspace_id),
            );
            return (jar, response).into_response();
        }
    };

    if let Err(message) = validate_slack_bot_scopes(&state, &workspace_tokens.access_token).await {
        let response = redirect_with_error_with_workspace(
            &state.config,
            provider,
            &message,
            Some(workspace_id),
        );
        return (jar, response).into_response();
    }

    let stored_personal = match state
        .oauth_accounts
        .save_authorization_deduped(user_id, provider, personal_tokens)
        .await
    {
        Ok(token) => token,
        Err(err) => {
            error!("Saving OAuth authorization failed: {err}");
            let response = redirect_with_error_with_workspace(
                &state.config,
                provider,
                &error_message_for_redirect(&err),
                Some(workspace_id),
            );
            return (jar, response).into_response();
        }
    };

    if let Err(err) = state
        .workspace_oauth
        .install_slack_workspace_connection(
            workspace_id,
            user_id,
            Some(stored_personal.id),
            workspace_tokens,
        )
        .await
    {
        error!("Saving Slack workspace install failed: {err}");
        let message = match err {
            WorkspaceOAuthError::Forbidden => {
                "Not authorized to install Slack for this workspace".to_string()
            }
            WorkspaceOAuthError::SlackInstallRequired => err.to_string(),
            WorkspaceOAuthError::OAuth(inner) => error_message_for_redirect(&inner),
            _ => "Failed to install Slack workspace connection".to_string(),
        };
        let response = redirect_with_error_with_workspace(
            &state.config,
            provider,
            &message,
            Some(workspace_id),
        );
        return (jar, response).into_response();
    }

    (
        jar,
        redirect_success_with_workspace(&state.config, provider, workspace_id),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct SlackAuthTestResponse {
    ok: bool,
    team_id: Option<String>,
    user_id: Option<String>,
    error: Option<String>,
    response_metadata: Option<SlackAuthTestMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct SlackAuthTestMetadata {
    scopes: Option<Vec<String>>,
    scope: Option<String>,
}

struct SlackAuthTestResult {
    team_id: Option<String>,
    #[allow(dead_code)]
    user_id: Option<String>,
    scopes: Vec<String>,
}

async fn validate_slack_bot_scopes(state: &AppState, access_token: &str) -> Result<(), String> {
    let auth_test = slack_auth_test(state, access_token, true).await?;
    let required = split_scopes(state.oauth_accounts.slack_bot_scopes());
    let missing: Vec<String> = required
        .iter()
        .filter(|scope| !auth_test.scopes.iter().any(|s| s == *scope))
        .cloned()
        .collect();

    if missing.is_empty() {
        return Ok(());
    }

    warn!(
        provider = "slack",
        team_id = ?auth_test.team_id,
        missing = ?missing,
        "Slack bot token missing required scopes"
    );

    Err(format!(
        "Slack install missing required bot scopes ({}). Reinstall Slack to continue.",
        missing.join(", ")
    ))
}

async fn slack_auth_test(
    state: &AppState,
    access_token: &str,
    require_scopes: bool,
) -> Result<SlackAuthTestResult, String> {
    let base = std::env::var("SLACK_API_BASE_URL")
        .ok()
        .or_else(|| std::env::var("SLACK_API_BASE").ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "https://slack.com/api".to_string());
    let url = format!("{}/auth.test", base.trim_end_matches('/'));

    let response = state
        .http_client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|err| {
            error!(?err, "Slack auth.test request failed");
            "Slack auth.test request failed".to_string()
        })?;

    let status = response.status();
    let headers = response.headers().clone();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        error!(%status, body, "Slack auth.test returned HTTP error");
        return Err("Slack auth.test failed".to_string());
    }

    let parsed: SlackAuthTestResponse = serde_json::from_str(&body).map_err(|err| {
        error!(?err, body, "Slack auth.test response parse failed");
        "Slack auth.test returned an unexpected response".to_string()
    })?;

    if !parsed.ok {
        let message = parsed
            .error
            .unwrap_or_else(|| "Slack auth.test failed".to_string());
        error!(error = %message, "Slack auth.test returned error");
        return Err(message);
    }

    let mut scopes = headers
        .get("x-oauth-scopes")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(split_scopes)
        .unwrap_or_default();

    if scopes.is_empty() {
        if let Some(metadata) = parsed.response_metadata.as_ref() {
            if let Some(list) = metadata.scopes.as_ref() {
                scopes = list
                    .iter()
                    .map(|scope| scope.trim())
                    .filter(|scope| !scope.is_empty())
                    .map(|scope| scope.to_string())
                    .collect();
            } else if let Some(scope) = metadata.scope.as_deref() {
                scopes = split_scopes(scope);
            }
        }
    }

    if require_scopes && scopes.is_empty() {
        return Err("Slack auth.test response missing scopes".to_string());
    }

    let team_id = parsed
        .team_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let user_id = parsed
        .user_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let token_prefix: String = access_token.chars().take(12).collect();
    if require_scopes {
        info!(
            provider = "slack",
            token_prefix = %token_prefix,
            team_id = ?team_id,
            scopes = %scopes.join(","),
            "Slack bot token validated via auth.test"
        );
    } else {
        info!(
            provider = "slack",
            token_prefix = %token_prefix,
            team_id = ?team_id,
            user_id = ?user_id,
            "Slack user token validated via auth.test"
        );
    }

    Ok(SlackAuthTestResult {
        team_id,
        user_id,
        scopes,
    })
}

fn split_scopes(scopes: &str) -> Vec<String> {
    scopes
        .split(',')
        .map(|scope| scope.trim())
        .filter(|scope| !scope.is_empty())
        .map(|scope| scope.to_string())
        .collect()
}

pub async fn asana_connect_start(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Query(params): Query<ConnectQuery>,
    jar: CookieJar,
) -> Response {
    match Uuid::parse_str(&claims.id) {
        Ok(user_id) => {
            if let Err(response) = ensure_oauth_permissions(
                &state,
                user_id,
                claims.plan.as_deref(),
                params.workspace,
                ConnectedOAuthProvider::Asana,
            )
            .await
            {
                return response;
            }
        }
        Err(_) => {
            let plan_tier = NormalizedPlanTier::from_option(claims.plan.as_deref());
            if plan_tier.is_solo() {
                return redirect_with_error(
                    &state.config,
                    ConnectedOAuthProvider::Asana,
                    OAUTH_PLAN_RESTRICTION_MESSAGE,
                );
            }
        }
    }

    let state_token = generate_csrf_token();
    let cookie = build_state_cookie(ASANA_STATE_COOKIE, &state_token);
    let jar = jar.add(cookie);

    let mut url = Url::parse(ASANA_AUTH_URL).expect("valid asana auth url");
    url.query_pairs_mut()
        .append_pair("client_id", &state.config.oauth.asana.client_id)
        .append_pair("redirect_uri", &state.config.oauth.asana.redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", state.oauth_accounts.asana_scopes())
        .append_pair("state", &state_token);

    (jar, Redirect::to(url.as_str())).into_response()
}

pub async fn asana_connect_callback(
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
        ConnectedOAuthProvider::Asana,
        ASANA_STATE_COOKIE,
    )
    .await
}
