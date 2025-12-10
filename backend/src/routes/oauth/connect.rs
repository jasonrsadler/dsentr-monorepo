use super::{
    helpers::{
        build_state_cookie, handle_callback, redirect_with_error, CallbackQuery, ASANA_AUTH_URL,
        ASANA_STATE_COOKIE, GOOGLE_AUTH_URL, GOOGLE_STATE_COOKIE, MICROSOFT_AUTH_URL,
        MICROSOFT_STATE_COOKIE, OAUTH_PLAN_RESTRICTION_MESSAGE, SLACK_AUTH_URL, SLACK_STATE_COOKIE,
    },
    prelude::*,
};
use crate::models::workspace::WorkspaceRole;

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
                        return Err(redirect_with_error(
                            &state.config,
                            provider,
                            OAUTH_VIEWER_RESTRICTION_MESSAGE,
                        ));
                    }

                    let plan_tier =
                        NormalizedPlanTier::from_option(Some(membership.workspace.plan.as_str()));
                    if plan_tier.is_solo() {
                        return Err(redirect_with_error(
                            &state.config,
                            provider,
                            OAUTH_PLAN_RESTRICTION_MESSAGE,
                        ));
                    }

                    return Ok(());
                }

                return Err(redirect_with_error(
                    &state.config,
                    provider,
                    "You do not have access to this workspace.",
                ));
            }
            Err(err) => {
                error!(%user_id, %workspace_id, ?err, "failed to load workspace memberships");
                return Err(redirect_with_error(
                    &state.config,
                    provider,
                    OAUTH_WORKSPACE_ACCESS_ERROR_MESSAGE,
                ));
            }
        }
    }

    let plan_tier = state.resolve_plan_tier(user_id, claims_plan).await;
    if plan_tier.is_solo() {
        return Err(redirect_with_error(
            &state.config,
            provider,
            OAUTH_PLAN_RESTRICTION_MESSAGE,
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
    match Uuid::parse_str(&claims.id) {
        Ok(user_id) => {
            if let Err(response) = ensure_oauth_permissions(
                &state,
                user_id,
                claims.plan.as_deref(),
                params.workspace,
                ConnectedOAuthProvider::Slack,
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
                    ConnectedOAuthProvider::Slack,
                    OAUTH_PLAN_RESTRICTION_MESSAGE,
                );
            }
        }
    }

    let state_token = generate_csrf_token();
    let cookie = build_state_cookie(SLACK_STATE_COOKIE, &state_token);
    let jar = jar.add(cookie);

    let mut url = Url::parse(SLACK_AUTH_URL).expect("valid slack auth url");
    url.query_pairs_mut()
        .append_pair("client_id", &state.config.oauth.slack.client_id)
        .append_pair("redirect_uri", &state.config.oauth.slack.redirect_uri)
        .append_pair("response_type", "code")
        //  This is only for bot apps - dont use scope, only user_scope ---> .append_pair("scope", state.oauth_accounts.slack_scopes())
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
    handle_callback(
        state,
        claims,
        jar,
        query,
        ConnectedOAuthProvider::Slack,
        SLACK_STATE_COOKIE,
    )
    .await
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
