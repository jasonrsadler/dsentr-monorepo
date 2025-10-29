use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use chrono::{Duration, Utc};
use time::Duration as TimeDuration;
use uuid::Uuid;

use crate::{
    responses::JsonResponse,
    routes::auth::claims::{Claims, TokenUse},
    state::AppState,
    utils::jwt::{create_jwt, decode_jwt},
};

pub async fn handle_refresh(State(app_state): State<AppState>, jar: CookieJar) -> Response {
    let Some(refresh_cookie) = jar.get("auth_refresh_token") else {
        return JsonResponse::unauthorized("Refresh token missing").into_response();
    };

    let token_data = match decode_jwt(
        refresh_cookie.value(),
        app_state.jwt_keys.as_ref(),
        &app_state.config.jwt_issuer,
        &app_state.config.jwt_audience,
    ) {
        Ok(data) => data,
        Err(_) => return JsonResponse::unauthorized("Invalid refresh token").into_response(),
    };

    if token_data.claims.token_use != TokenUse::Refresh {
        return JsonResponse::unauthorized("Invalid refresh token").into_response();
    }

    let user_id = match Uuid::parse_str(&token_data.claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid refresh token").into_response(),
    };

    let user = match app_state.db.find_public_user_by_id(user_id).await {
        Ok(Some(user)) => user,
        Ok(None) => return JsonResponse::unauthorized("User not found").into_response(),
        Err(err) => {
            tracing::error!(?err, %user_id, "failed to load user during refresh");
            return JsonResponse::server_error("Failed to refresh session").into_response();
        }
    };

    let access_duration = Duration::minutes(45);

    let access_claims = Claims {
        id: user.id.to_string(),
        email: user.email.clone(),
        exp: (Utc::now() + access_duration).timestamp() as usize,
        first_name: user.first_name.clone(),
        last_name: user.last_name.clone(),
        role: user.role,
        plan: user.plan.clone(),
        company_name: user.company_name.clone(),
        iss: String::new(),
        aud: String::new(),
        token_use: TokenUse::Access,
    };

    let access_token = match create_jwt(
        access_claims,
        app_state.jwt_keys.as_ref(),
        &app_state.config.jwt_issuer,
        &app_state.config.jwt_audience,
    ) {
        Ok(token) => token,
        Err(err) => {
            tracing::error!(?err, %user_id, "failed to create access token during refresh");
            return JsonResponse::server_error("Failed to refresh session").into_response();
        }
    };

    let remaining_seconds = token_data.claims.exp as i64 - Utc::now().timestamp();
    if remaining_seconds <= 0 {
        return JsonResponse::unauthorized("Refresh token expired").into_response();
    }

    let refresh_duration = Duration::seconds(remaining_seconds);

    let refresh_claims = Claims {
        id: user.id.to_string(),
        email: user.email.clone(),
        exp: (Utc::now() + refresh_duration).timestamp() as usize,
        first_name: user.first_name.clone(),
        last_name: user.last_name.clone(),
        role: user.role,
        plan: user.plan.clone(),
        company_name: user.company_name.clone(),
        iss: String::new(),
        aud: String::new(),
        token_use: TokenUse::Refresh,
    };

    let refresh_token = match create_jwt(
        refresh_claims,
        app_state.jwt_keys.as_ref(),
        &app_state.config.jwt_issuer,
        &app_state.config.jwt_audience,
    ) {
        Ok(token) => token,
        Err(err) => {
            tracing::error!(?err, %user_id, "failed to rotate refresh token");
            return JsonResponse::server_error("Failed to refresh session").into_response();
        }
    };

    let secure_cookie = app_state.config.auth_cookie_secure;
    let mut headers = HeaderMap::new();

    let access_cookie = Cookie::build(("auth_token", access_token))
        .http_only(true)
        .secure(secure_cookie)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(TimeDuration::seconds(access_duration.num_seconds()))
        .build();

    headers.insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&access_cookie.to_string()).unwrap(),
    );

    let refresh_cookie = Cookie::build(("auth_refresh_token", refresh_token))
        .http_only(true)
        .secure(secure_cookie)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(TimeDuration::seconds(refresh_duration.num_seconds()))
        .build();

    headers.append(
        header::SET_COOKIE,
        HeaderValue::from_str(&refresh_cookie.to_string()).unwrap(),
    );

    (headers, JsonResponse::success("Session refreshed")).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::StatusCode, response::IntoResponse};
    use axum_extra::extract::cookie::Cookie;
    use reqwest::Client;
    use std::sync::Arc;
    use time::OffsetDateTime;
    use uuid::Uuid;

    use crate::{
        config::{Config, OAuthProviderConfig, OAuthSettings, StripeSettings},
        db::{
            mock_db::{MockDb, NoopWorkflowRepository, NoopWorkspaceRepository},
            workspace_connection_repository::NoopWorkspaceConnectionRepository,
        },
        models::user::{User, UserRole},
        services::{
            oauth::{
                account_service::OAuthAccountService, github::mock_github_oauth::MockGitHubOAuth,
                google::mock_google_oauth::MockGoogleOAuth,
                workspace_service::WorkspaceOAuthService,
            },
            smtp_mailer::MockMailer,
        },
        utils::jwt::JwtKeys,
    };

    fn build_state(user: User) -> AppState {
        let config = Arc::new(Config {
            database_url: String::new(),
            frontend_origin: "http://localhost".into(),
            oauth: OAuthSettings {
                google: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                microsoft: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                slack: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                token_encryption_key: vec![0u8; 32],
            },
            stripe: StripeSettings {
                client_id: "stub".into(),
                secret_key: "stub".into(),
                webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            },
            auth_cookie_secure: true,
            webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            jwt_issuer: "test-issuer".into(),
            jwt_audience: "test-audience".into(),
        });

        let db = MockDb {
            find_user_result: Some(user),
            ..Default::default()
        };

        AppState {
            db: Arc::new(db),
            workflow_repo: Arc::new(NoopWorkflowRepository),
            workspace_repo: Arc::new(NoopWorkspaceRepository),
            workspace_connection_repo: Arc::new(NoopWorkspaceConnectionRepository),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts: OAuthAccountService::test_stub(),
            workspace_oauth: WorkspaceOAuthService::test_stub(),
            stripe: Arc::new(crate::services::stripe::MockStripeService::new()),
            http_client: Arc::new(Client::new()),
            config,
            worker_id: Arc::new("test-worker".into()),
            worker_lease_seconds: 30,
            jwt_keys: Arc::new(
                JwtKeys::from_secret("0123456789abcdef0123456789abcdef")
                    .expect("test JWT secret should be valid"),
            ),
        }
    }

    fn sample_user() -> User {
        User {
            id: Uuid::new_v4(),
            email: "refresh@example.com".into(),
            password_hash: "hash".into(),
            first_name: "Refresh".into(),
            last_name: "Tester".into(),
            role: Some(UserRole::User),
            plan: Some("free".into()),
            company_name: Some("Example".into()),
            stripe_customer_id: None,
            oauth_provider: None,
            onboarded_at: Some(OffsetDateTime::now_utc()),
            created_at: OffsetDateTime::now_utc(),
        }
    }

    fn encode_refresh_token(state: &AppState, user: &User, expires_in: Duration) -> String {
        let claims = Claims {
            id: user.id.to_string(),
            email: user.email.clone(),
            exp: (Utc::now() + expires_in).timestamp() as usize,
            first_name: user.first_name.clone(),
            last_name: user.last_name.clone(),
            role: user.role,
            plan: user.plan.clone(),
            company_name: user.company_name.clone(),
            iss: String::new(),
            aud: String::new(),
            token_use: TokenUse::Refresh,
        };

        create_jwt(
            claims,
            state.jwt_keys.as_ref(),
            &state.config.jwt_issuer,
            &state.config.jwt_audience,
        )
        .expect("refresh token should encode")
    }

    #[tokio::test]
    async fn refresh_sets_new_cookies() {
        let user = sample_user();
        let state = build_state(user.clone());
        let refresh_token = encode_refresh_token(&state, &user, Duration::days(7));

        let jar = CookieJar::new().add(Cookie::new("auth_refresh_token", refresh_token));

        let response = handle_refresh(State(state.clone()), jar)
            .await
            .into_response();

        assert_eq!(response.status(), StatusCode::OK);
        let cookies: Vec<String> = response
            .headers()
            .get_all("set-cookie")
            .iter()
            .map(|v| v.to_str().unwrap().to_string())
            .collect();
        assert!(cookies.iter().any(|c| c.contains("auth_token=")));
        assert!(cookies.iter().any(|c| c.contains("auth_refresh_token=")));
    }

    #[tokio::test]
    async fn missing_refresh_cookie_is_unauthorized() {
        let state = build_state(sample_user());
        let response = handle_refresh(State(state), CookieJar::new())
            .await
            .into_response();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn refresh_rejects_wrong_token_type() {
        let user = sample_user();
        let state = build_state(user.clone());
        let claims = Claims {
            id: user.id.to_string(),
            email: user.email.clone(),
            exp: (Utc::now() + Duration::minutes(10)).timestamp() as usize,
            first_name: user.first_name.clone(),
            last_name: user.last_name.clone(),
            role: user.role,
            plan: user.plan.clone(),
            company_name: user.company_name.clone(),
            iss: String::new(),
            aud: String::new(),
            token_use: TokenUse::Access,
        };
        let access_token = create_jwt(
            claims,
            state.jwt_keys.as_ref(),
            &state.config.jwt_issuer,
            &state.config.jwt_audience,
        )
        .expect("token");

        let jar = CookieJar::new().add(Cookie::new("auth_refresh_token", access_token));
        let response = handle_refresh(State(state), jar).await.into_response();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}
