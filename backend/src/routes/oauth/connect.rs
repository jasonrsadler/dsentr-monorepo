use super::{
    helpers::{
        build_state_cookie, handle_callback, redirect_with_error, CallbackQuery, GOOGLE_AUTH_URL,
        GOOGLE_STATE_COOKIE, MICROSOFT_AUTH_URL, MICROSOFT_STATE_COOKIE,
        OAUTH_PLAN_RESTRICTION_MESSAGE,
    },
    prelude::*,
};

pub async fn google_connect_start(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    jar: CookieJar,
) -> Response {
    let plan_tier = match Uuid::parse_str(&claims.id) {
        Ok(user_id) => {
            state
                .resolve_plan_tier(user_id, claims.plan.as_deref())
                .await
        }
        Err(_) => NormalizedPlanTier::from_str(claims.plan.as_deref()),
    };
    if plan_tier.is_solo() {
        return redirect_with_error(
            &state.config,
            ConnectedOAuthProvider::Google,
            OAUTH_PLAN_RESTRICTION_MESSAGE,
        );
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
    jar: CookieJar,
) -> Response {
    let plan_tier = match Uuid::parse_str(&claims.id) {
        Ok(user_id) => {
            state
                .resolve_plan_tier(user_id, claims.plan.as_deref())
                .await
        }
        Err(_) => NormalizedPlanTier::from_str(claims.plan.as_deref()),
    };
    if plan_tier.is_solo() {
        return redirect_with_error(
            &state.config,
            ConnectedOAuthProvider::Microsoft,
            OAUTH_PLAN_RESTRICTION_MESSAGE,
        );
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
