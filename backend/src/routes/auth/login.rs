use crate::routes::auth::claims::{Claims, TokenUse};
use crate::{
    responses::JsonResponse,
    state::AppState,
    utils::{jwt::create_jwt, password::verify_password, plan_limits::NormalizedPlanTier},
};

use axum::{
    extract::{Json, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::{Cookie, SameSite};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, to_value};
use time::Duration as TimeDuration;
use uuid::Uuid;

use super::session::AuthSession;

#[derive(Deserialize, Serialize)]
pub struct LoginPayload {
    pub email: String,
    pub password: String,
    pub remember: bool,
}

pub async fn handle_login(
    State(app_state): State<AppState>,
    Json(payload): Json<LoginPayload>,
) -> Response {
    let user = app_state.db.find_user_by_email(&payload.email).await;
    let user = match user {
        Ok(Some(record)) => record,
        Ok(None) => return JsonResponse::unauthorized("Invalid credentials").into_response(),
        Err(e) => {
            eprintln!("DB error: {:?}", e);
            return JsonResponse::server_error("Database error").into_response();
        }
    };

    if user.password_hash.trim().is_empty() {
        let provider = user.oauth_provider;
        let provider_name = provider
            .map(|p| p.to_string())
            .unwrap_or("an OAuth provider".to_string());
        return JsonResponse::unauthorized(&format!(
            "This account was created with {} login. Please use that provider to sign in.",
            provider_name
        ))
        .into_response();
    }
    match verify_password(&payload.password, &user.password_hash) {
        Ok(true) => {
            let access_duration = Duration::minutes(45);
            let refresh_duration = if payload.remember {
                Duration::days(30)
            } else {
                Duration::days(7)
            };

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

            let requires_onboarding = user.onboarded_at.is_none()
                || user.plan.as_ref().map(|p| p.is_empty()).unwrap_or(true);

            let memberships = match app_state
                .workspace_repo
                .list_memberships_for_user(user.id)
                .await
            {
                Ok(data) => data,
                Err(err) => {
                    tracing::error!(
                        "failed to load workspace memberships for user {}: {:?}",
                        user.id,
                        err
                    );
                    return JsonResponse::server_error("Failed to load workspace context")
                        .into_response();
                }
            };

            match (
                create_jwt(
                    access_claims,
                    app_state.jwt_keys.as_ref(),
                    &app_state.config.jwt_issuer,
                    &app_state.config.jwt_audience,
                ),
                create_jwt(
                    refresh_claims,
                    app_state.jwt_keys.as_ref(),
                    &app_state.config.jwt_issuer,
                    &app_state.config.jwt_audience,
                ),
            ) {
                (Ok(access_token), Ok(refresh_token)) => {
                    let secure_cookie = app_state.config.auth_cookie_secure;
                    let access_cookie = Cookie::build(("auth_token", access_token))
                        .http_only(true)
                        .secure(secure_cookie)
                        .same_site(SameSite::Lax)
                        .path("/")
                        .max_age(TimeDuration::seconds(access_duration.num_seconds()))
                        .build();

                    let refresh_cookie = Cookie::build(("auth_refresh_token", refresh_token))
                        .http_only(true)
                        .secure(secure_cookie)
                        .same_site(SameSite::Lax)
                        .path("/")
                        .max_age(TimeDuration::seconds(refresh_duration.num_seconds()))
                        .build();

                    let mut headers = HeaderMap::new();
                    headers.insert(
                        header::SET_COOKIE,
                        HeaderValue::from_str(&access_cookie.to_string()).unwrap(),
                    );
                    headers.append(
                        header::SET_COOKIE,
                        HeaderValue::from_str(&refresh_cookie.to_string()).unwrap(),
                    );
                    let user_json = to_value(&user).expect("User serialization failed");
                    let memberships_json =
                        to_value(&memberships).expect("Membership serialization failed");
                    (
                        StatusCode::OK,
                        headers,
                        Json(json!({
                            "success": true,
                            "user": user_json,
                            "memberships": memberships_json,
                            "requires_onboarding": requires_onboarding
                        })),
                    )
                        .into_response()
                }
                (Err(e), _) | (_, Err(e)) => {
                    eprintln!("JWT error: {:?}", e);
                    JsonResponse::server_error("Token generation failed").into_response()
                }
            }
        }
        Ok(false) => JsonResponse::unauthorized("Invalid credentials").into_response(),
        Err(e) => {
            eprintln!("Password verification error: {:?}", e);
            JsonResponse::server_error("Internal error").into_response()
        }
    }
}

pub async fn handle_me(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let user = app_state.db.find_public_user_by_id(user_id).await;

    match user {
        Ok(Some(mut user)) => {
            // Passive billing reconciliation: if personal plan is workspace but Stripe has no active subscription
            // and there is no pending checkout, revert plan to solo and downgrade owned workspaces.
            let mut has_pending_checkout = false;
            if let Ok(settings) = app_state.db.get_user_settings(user_id).await {
                if let Some(obj) = settings.as_object() {
                    if let Some(b) = obj.get("billing").and_then(|v| v.as_object()) {
                        has_pending_checkout = b
                            .get("pending_checkout")
                            .map(|v| !v.is_null())
                            .unwrap_or(false);
                    }
                }
            }
            let mut should_revert = false;
            if !NormalizedPlanTier::from_option(user.plan.as_deref()).is_solo()
                && !has_pending_checkout
            {
                if let Ok(Some(customer_id)) =
                    app_state.db.get_user_stripe_customer_id(user.id).await
                {
                    match app_state
                        .stripe
                        .get_active_subscription_for_customer(&customer_id)
                        .await
                    {
                        Ok(Some(_)) => { /* active subscription present */ }
                        Ok(None) => should_revert = true,
                        Err(err) => {
                            tracing::warn!(?err, user_id=%user.id, "stripe subscription lookup failed during session check");
                        }
                    }
                }
            }
            if should_revert {
                if let Err(err) = app_state.db.update_user_plan(user.id, "solo").await {
                    tracing::warn!(?err, user_id=%user.id, "failed to revert user plan to solo during session check");
                } else {
                    // Downgrade any owned workspaces to solo
                    if let Ok(memberships) = app_state
                        .workspace_repo
                        .list_memberships_for_user(user.id)
                        .await
                    {
                        for m in memberships.into_iter().filter(|m| {
                            m.workspace.owner_id == user.id && m.workspace.plan.as_str() != "solo"
                        }) {
                            if let Err(err) = app_state
                                .workspace_repo
                                .update_workspace_plan(m.workspace.id, "solo")
                                .await
                            {
                                tracing::warn!(?err, workspace_id=%m.workspace.id, user_id=%user.id, "failed to downgrade workspace to solo during session check");
                            }
                        }
                    }
                    // Refresh user after change for response
                    if let Ok(Some(u)) = app_state.db.find_public_user_by_id(user.id).await {
                        user = u;
                    }
                }
            }

            let memberships = match app_state
                .workspace_repo
                .list_memberships_for_user(user.id)
                .await
            {
                Ok(data) => data,
                Err(err) => {
                    tracing::error!(
                        "failed to load workspace memberships for user {}: {:?}",
                        user.id,
                        err
                    );
                    return JsonResponse::server_error("Failed to load workspace context")
                        .into_response();
                }
            };

            let requires_onboarding = user.onboarded_at.is_none()
                || user.plan.as_ref().map(|p| p.is_empty()).unwrap_or(true);

            let user_json = to_value(&user).expect("User serialization failed");
            Json(json!({
                "success": true,
                "user": user_json,
                "memberships": memberships,
                "requires_onboarding": requires_onboarding
            }))
            .into_response()
        }
        Ok(None) => JsonResponse::unauthorized("User not found").into_response(),
        Err(e) => {
            eprintln!("DB error in handle_me: {:?}", e);
            JsonResponse::server_error("Database error").into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use argon2::{Argon2, PasswordHasher};
    use axum::{
        body::{to_bytes, Body},
        extract::Request,
        http::StatusCode,
        routing::post,
        Router,
    };
    use password_hash::SaltString;
    use rand_core::OsRng;
    use time::OffsetDateTime;
    use tower::ServiceExt;
    use uuid::Uuid;

    use crate::{
        config::{Config, OAuthProviderConfig, OAuthSettings, StripeSettings},
        db::{
            mock_db::{MockDb, NoopWorkflowRepository, NoopWorkspaceRepository},
            user_repository::UserRepository,
            workspace_connection_repository::NoopWorkspaceConnectionRepository,
        },
        models::user::{OauthProvider, User, UserRole},
        routes::auth::login::LoginPayload,
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

    use super::handle_login;

    fn test_user_with_password(password: &str) -> (User, String) {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .unwrap()
            .to_string();

        let user = User {
            id: Uuid::new_v4(),
            email: "test@example.com".into(),
            password_hash: hash.clone(),
            oauth_provider: None,
            first_name: "Test".into(),
            last_name: "User".into(),
            role: Some(UserRole::User),
            plan: Some("free".into()),
            company_name: Some("Acme Corp".into()),
            stripe_customer_id: None,
            onboarded_at: None,
            created_at: OffsetDateTime::now_utc(),
        };

        (user, password.to_string())
    }

    fn test_jwt_keys() -> Arc<JwtKeys> {
        Arc::new(
            JwtKeys::from_secret("0123456789abcdef0123456789abcdef")
                .expect("test JWT secret should be valid"),
        )
    }

    fn build_app(db: impl UserRepository + 'static, secure_cookie: bool) -> Router {
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
        let app_state = AppState {
            db: Arc::new(db),
            workflow_repo: Arc::new(NoopWorkflowRepository),
            workspace_repo: Arc::new(NoopWorkspaceRepository),
            workspace_connection_repo: Arc::new(NoopWorkspaceConnectionRepository),
            mailer: Arc::new(MockMailer::default()), // Not used in these tests
            google_oauth: Arc::new(MockGoogleOAuth::default()), // Not used in these tests
            github_oauth: Arc::new(MockGitHubOAuth::default()), // Not used in these tests
            oauth_accounts: OAuthAccountService::test_stub(),
            workspace_oauth: WorkspaceOAuthService::test_stub(),
            stripe: Arc::new(crate::services::stripe::MockStripeService::new()),
            http_client: Arc::new(Client::new()),
            config,
            worker_id: Arc::new("test-worker".to_string()),
            worker_lease_seconds: 30,
            jwt_keys: test_jwt_keys(),
        };

        Router::new()
            .route("/login", post(handle_login))
            .with_state(app_state)
    }

    // --- Tests ---

    #[tokio::test]
    async fn test_login_success() {
        let password = "password123";
        let (user, _) = test_user_with_password(password);
        eprintln!("User going into MockDb: {:?}", user.email);
        let app = build_app(
            MockDb {
                find_user_result: Some(user.clone()),
                ..Default::default()
            },
            false,
        );

        let payload = LoginPayload {
            email: user.email.clone(),
            password: password.to_string(),
            remember: true,
        };

        let res = app
            .oneshot(
                Request::post("/login")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::OK);
        let cookies: Vec<String> = res
            .headers()
            .get_all("set-cookie")
            .iter()
            .map(|v| v.to_str().unwrap().to_string())
            .collect();
        assert!(cookies.iter().any(|c| c.contains("auth_token=")));
        assert!(cookies.iter().any(|c| c.contains("auth_refresh_token=")));

        let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["user"]["email"], user.email);
        assert!(json["memberships"].is_array());
        assert_eq!(json["requires_onboarding"], true);
    }

    #[tokio::test]
    async fn test_login_uses_secure_cookie_when_enabled() {
        let password = "password123";
        let (user, _) = test_user_with_password(password);
        let app = build_app(
            MockDb {
                find_user_result: Some(user.clone()),
                ..Default::default()
            },
            true,
        );

        let payload = LoginPayload {
            email: user.email.clone(),
            password: password.to_string(),
            remember: false,
        };

        let res = app
            .oneshot(
                Request::post("/login")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
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
        assert!(cookies.iter().all(|c| c.contains("Secure")));
    }

    #[tokio::test]
    async fn test_login_uses_insecure_cookie_when_disabled() {
        let password = "password123";
        let (user, _) = test_user_with_password(password);
        let app = build_app(
            MockDb {
                find_user_result: Some(user.clone()),
                ..Default::default()
            },
            false,
        );

        let payload = LoginPayload {
            email: user.email.clone(),
            password: password.to_string(),
            remember: false,
        };

        let res = app
            .oneshot(
                Request::post("/login")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
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

    #[tokio::test]
    async fn test_login_requires_onboarding_when_missing_plan() {
        let password = "password123";
        let (mut user, _) = test_user_with_password(password);
        user.plan = None;
        user.onboarded_at = None;

        let app = build_app(
            MockDb {
                find_user_result: Some(user.clone()),
                ..Default::default()
            },
            false,
        );

        let payload = LoginPayload {
            email: user.email.clone(),
            password: password.to_string(),
            remember: false,
        };

        let res = app
            .oneshot(
                Request::post("/login")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::OK);
        let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["requires_onboarding"], true);
    }

    #[tokio::test]
    async fn test_login_wrong_password() {
        let password = "password123";
        let (user, _) = test_user_with_password(password);

        let app = build_app(
            MockDb {
                find_user_result: Some(user.clone()),
                ..Default::default()
            },
            false,
        );

        let payload = LoginPayload {
            email: user.email.clone(),
            password: "wrong-password".to_string(),
            remember: false,
        };

        let res = app
            .oneshot(
                Request::post("/login")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_login_user_not_found() {
        let app = build_app(
            MockDb {
                find_user_result: None,
                ..Default::default()
            },
            false,
        );

        let payload = LoginPayload {
            email: "unknown@example.com".to_string(),
            password: "irrelevant".to_string(),
            remember: false,
        };

        let res = app
            .oneshot(
                Request::post("/login")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_login_oauth_only_user() {
        let password_hash = "".to_string();
        let (mut user, _) = test_user_with_password(&password_hash);
        user.oauth_provider = Some(OauthProvider::Google);

        let app = build_app(
            MockDb {
                find_user_result: Some(user.clone()),
                ..Default::default()
            },
            false,
        );

        let payload = LoginPayload {
            email: user.email.clone(),
            password: "irrelevant".to_string(),
            remember: false,
        };

        let res = app
            .oneshot(
                Request::post("/login")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_login_db_error() {
        let app = build_app(
            MockDb {
                should_fail: true,
                ..Default::default()
            },
            false,
        );

        let payload = LoginPayload {
            email: "test@example.com".to_string(),
            password: "doesntmatter".to_string(),
            remember: false,
        };

        let res = app
            .oneshot(
                Request::post("/login")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
