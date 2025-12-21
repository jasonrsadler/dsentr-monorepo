use super::{
    helpers::{
        build_slack_state, build_state_cookie, clear_state_cookie, error_message_for_redirect,
        handle_callback, parse_slack_state, redirect_success_with_workspace, redirect_with_error,
        redirect_with_error_for_provider, redirect_with_error_with_workspace, strip_slack_webhook,
        CallbackQuery, ASANA_AUTH_URL, ASANA_STATE_COOKIE, GOOGLE_AUTH_URL, GOOGLE_STATE_COOKIE,
        MICROSOFT_AUTH_URL, MICROSOFT_STATE_COOKIE, OAUTH_PLAN_RESTRICTION_MESSAGE, SLACK_AUTH_URL,
        SLACK_STATE_COOKIE, SLACK_WORKSPACE_REQUIRED_MESSAGE,
    },
    prelude::*,
};
use crate::models::workspace::WorkspaceRole;
use crate::services::oauth::workspace_service::WorkspaceOAuthError;

#[derive(Debug, Default, Deserialize)]
pub struct ConnectQuery {
    #[serde(default)]
    pub workspace: Option<Uuid>,
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

    let mut url = Url::parse(SLACK_AUTH_URL).expect("valid slack auth url");
    url.query_pairs_mut()
        .append_pair("client_id", &state.config.oauth.slack.client_id)
        .append_pair("redirect_uri", &state.config.oauth.slack.redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", state.oauth_accounts.slack_bot_scopes())
        .append_pair("user_scope", state.oauth_accounts.slack_scopes())
        .append_pair("state", &state_token);

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

    let (mut personal_tokens, workspace_tokens) = match state
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

    strip_slack_webhook(&mut personal_tokens);

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
