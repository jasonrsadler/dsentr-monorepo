use super::*;
use axum::{
    extract::State,
    http::{header, StatusCode},
};
use axum_extra::extract::cookie::CookieJar;
use std::sync::Arc;

use crate::config::{Config, OAuthProviderConfig, OAuthSettings};
use crate::db::mock_db::{MockDb, NoopWorkflowRepository, NoopWorkspaceRepository};
use crate::models::user::UserRole;
use crate::routes::auth::{claims::Claims, session::AuthSession};
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
        workspace_repo: Arc::new(NoopWorkspaceRepository::default()),
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

#[tokio::test]
async fn solo_plan_google_start_redirects_with_upgrade_message() {
    let config = stub_config();
    let state = stub_state(config.clone());
    let claims = Claims {
        plan: Some("solo".into()),
        ..stub_claims()
    };

    let response = google_connect_start(State(state), AuthSession(claims), CookieJar::new()).await;

    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let location = response
        .headers()
        .get(header::LOCATION)
        .expect("location header present");
    let location = location.to_str().unwrap();
    assert!(location.contains("connected=false"));
    assert!(location.contains("provider=google"));
}

#[tokio::test]
async fn workspace_plan_google_start_sets_state_cookie() {
    let config = stub_config();
    let state = stub_state(config.clone());
    let claims = Claims {
        plan: Some("workspace".into()),
        ..stub_claims()
    };

    let response = google_connect_start(State(state), AuthSession(claims), CookieJar::new()).await;

    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let cookies = response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|value| value.to_str().unwrap())
        .collect::<Vec<_>>();
    assert!(cookies
        .iter()
        .any(|cookie| cookie.contains(GOOGLE_STATE_COOKIE)));
}
