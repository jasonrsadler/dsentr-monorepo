use axum::{
    extract::State,
    http::{header::SET_COOKIE, HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
};
use axum_extra::extract::cookie::{Cookie, SameSite};
use time::Duration as TimeDuration;

use crate::{responses::JsonResponse, state::AppState};

pub async fn handle_logout(State(app_state): State<AppState>) -> impl IntoResponse {
    let secure_cookie = app_state.config.auth_cookie_secure;
    let expired_cookie = Cookie::build(("auth_token", ""))
        .path("/")
        .http_only(true)
        .secure(secure_cookie)
        .same_site(SameSite::Lax)
        .max_age(TimeDuration::seconds(0))
        .build();
    let expired_refresh = Cookie::build(("auth_refresh_token", ""))
        .path("/")
        .http_only(true)
        .secure(secure_cookie)
        .same_site(SameSite::Lax)
        .max_age(TimeDuration::seconds(0))
        .build();
    // Set the Set-Cookie header
    let mut headers = HeaderMap::new();
    headers.insert(
        SET_COOKIE,
        HeaderValue::from_str(&expired_cookie.to_string()).unwrap(),
    );
    headers.append(
        SET_COOKIE,
        HeaderValue::from_str(&expired_refresh.to_string()).unwrap(),
    );

    (StatusCode::OK, headers, JsonResponse::success("Logged out"))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
        routing::post,
        Router,
    };
    use serde_json::Value;
    use tower::ServiceExt; // for `app.oneshot(...)`

    use crate::{
        config::{Config, OAuthProviderConfig, OAuthSettings, StripeSettings},
        db::{
            mock_db::{MockDb, NoopWorkflowRepository, NoopWorkspaceRepository},
            workspace_connection_repository::NoopWorkspaceConnectionRepository,
        },
        routes::auth::logout::handle_logout,
        services::{
            oauth::{
                account_service::OAuthAccountService, github::mock_github_oauth::MockGitHubOAuth,
                google::mock_google_oauth::MockGoogleOAuth,
                workspace_service::WorkspaceOAuthService,
            },
            smtp_mailer::MockMailer,
        },
        state::AppState,
        utils::jwt::JwtKeys,
    };

    use reqwest::Client;

    fn test_state(secure_cookie: bool) -> AppState {
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
            auth_cookie_secure: secure_cookie,
            webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            jwt_issuer: "test-issuer".into(),
            jwt_audience: "test-audience".into(),
        });

        AppState {
            db: Arc::new(MockDb::default()),
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

    fn build_app(secure_cookie: bool) -> Router {
        Router::new()
            .route("/logout", post(handle_logout))
            .with_state(test_state(secure_cookie))
    }

    #[tokio::test]
    async fn test_logout_clears_auth_cookie_and_returns_success() {
        let app = build_app(true);

        // Simulate the POST request
        let res = app
            .oneshot(
                Request::post("/logout")
                    .header("Content-Type", "application/json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // Check status
        assert_eq!(res.status(), StatusCode::OK);

        // Check Set-Cookie header exists
        let cookies: Vec<String> = res
            .headers()
            .get_all("set-cookie")
            .iter()
            .map(|v| v.to_str().unwrap().to_string())
            .collect();
        assert!(cookies
            .iter()
            .any(|c| c.contains("auth_token=") && c.contains("Max-Age=0")));
        assert!(cookies
            .iter()
            .any(|c| c.contains("auth_refresh_token=") && c.contains("Max-Age=0")));
        assert!(cookies.iter().all(|c| c.contains("HttpOnly")));
        assert!(cookies.iter().all(|c| c.contains("Secure")));
        assert!(cookies.iter().all(|c| c.contains("SameSite=Lax")));

        // Check body
        let body_bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["message"], "Logged out");
    }

    #[tokio::test]
    async fn test_logout_uses_non_secure_cookie_when_disabled() {
        let app = build_app(false);

        let res = app
            .oneshot(
                Request::post("/logout")
                    .header("Content-Type", "application/json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let cookies: Vec<String> = res
            .headers()
            .get_all("set-cookie")
            .iter()
            .map(|v| v.to_str().unwrap().to_string())
            .collect();
        assert!(cookies.iter().all(|c| !c.contains("Secure")));
    }
}
