use async_trait::async_trait;
use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
};
use axum_extra::extract::cookie::CookieJar;
use std::sync::Arc;

use crate::config::{Config, OAuthProviderConfig, OAuthSettings, StripeSettings};
use crate::db::{
    mock_db::{MockDb, NoopWorkflowRepository, NoopWorkspaceRepository},
    oauth_token_repository::{NewUserOAuthToken, UserOAuthTokenRepository},
    workspace_connection_repository::{
        NewWorkspaceAuditEvent, NewWorkspaceConnection, NoopWorkspaceConnectionRepository,
        WorkspaceConnectionListing, WorkspaceConnectionRepository,
    },
    workspace_repository::WorkspaceRepository,
};
use crate::models::oauth_token::{UserOAuthToken, WorkspaceAuditEvent, WorkspaceConnection};
use crate::models::user::UserRole;
use crate::models::workspace::{Workspace, WorkspaceMembershipSummary, WorkspaceRole};
use crate::routes::auth::{
    claims::{Claims, TokenUse},
    session::AuthSession,
};
use crate::services::{
    oauth::{
        account_service::{AuthorizationTokens, OAuthAccountError, OAuthAccountService},
        github::mock_github_oauth::MockGitHubOAuth,
        google::mock_google_oauth::MockGoogleOAuth,
        workspace_service::WorkspaceOAuthService,
    },
    smtp_mailer::MockMailer,
};
use crate::state::AppState;
use crate::utils::encryption::encrypt_secret;
use crate::utils::jwt::JwtKeys;
use serde_json::Value;
use sqlx::Error;
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};
use urlencoding::encode;
use uuid::Uuid;

use super::{
    accounts::{list_connections, refresh_connection, ListConnectionsQuery},
    connect::{google_connect_start, slack_connect_start, ConnectQuery},
    helpers::{
        build_state_cookie, error_message_for_redirect, handle_callback, parse_provider,
        CallbackQuery, GOOGLE_STATE_COOKIE, SLACK_STATE_COOKIE,
    },
    prelude::ConnectedOAuthProvider,
};

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
            slack: OAuthProviderConfig {
                client_id: "client".into(),
                client_secret: "secret".into(),
                redirect_uri: "http://localhost/slack".into(),
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
    })
}

fn stub_state(config: Arc<Config>) -> AppState {
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
        http_client: Arc::new(reqwest::Client::new()),
        config,
        worker_id: Arc::new("test-worker".into()),
        worker_lease_seconds: 30,
        jwt_keys: test_jwt_keys(),
    }
}

fn test_jwt_keys() -> Arc<JwtKeys> {
    Arc::new(
        JwtKeys::from_secret("0123456789abcdef0123456789abcdef")
            .expect("test JWT secret should be valid"),
    )
}

fn stub_state_with_workspace_repo(
    config: Arc<Config>,
    workspace_repo: Arc<dyn WorkspaceRepository>,
) -> AppState {
    AppState {
        workspace_repo,
        ..stub_state(config)
    }
}

struct MembershipWorkspaceRepo {
    memberships: Vec<WorkspaceMembershipSummary>,
}

impl MembershipWorkspaceRepo {
    fn new(memberships: Vec<WorkspaceMembershipSummary>) -> Self {
        Self { memberships }
    }
}

fn workspace_membership(
    workspace_id: Uuid,
    role: WorkspaceRole,
    plan: &str,
) -> WorkspaceMembershipSummary {
    WorkspaceMembershipSummary {
        workspace: Workspace {
            id: workspace_id,
            name: "Test".into(),
            created_by: Uuid::new_v4(),
            owner_id: Uuid::new_v4(),
            plan: plan.to_string(),
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            deleted_at: None,
        },
        role,
    }
}

#[derive(Clone)]
struct TokenRepo {
    tokens: Vec<UserOAuthToken>,
}

#[async_trait]
impl UserOAuthTokenRepository for TokenRepo {
    async fn upsert_token(
        &self,
        _new_token: NewUserOAuthToken,
    ) -> Result<UserOAuthToken, sqlx::Error> {
        Err(sqlx::Error::RowNotFound)
    }

    async fn find_by_user_and_provider(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<Option<UserOAuthToken>, sqlx::Error> {
        Ok(self
            .tokens
            .iter()
            .find(|token| token.user_id == user_id && token.provider == provider)
            .cloned())
    }

    async fn delete_token(
        &self,
        _user_id: Uuid,
        _provider: ConnectedOAuthProvider,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn list_tokens_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<UserOAuthToken>, sqlx::Error> {
        Ok(self
            .tokens
            .iter()
            .filter(|token| token.user_id == user_id)
            .cloned()
            .collect())
    }

    async fn mark_shared(
        &self,
        _user_id: Uuid,
        _provider: ConnectedOAuthProvider,
        _is_shared: bool,
    ) -> Result<UserOAuthToken, sqlx::Error> {
        Err(sqlx::Error::RowNotFound)
    }
}

#[derive(Clone)]
struct WorkspaceConnectionsStub {
    entries: Vec<(Uuid, WorkspaceConnectionListing)>,
}

impl WorkspaceConnectionsStub {
    fn new(entries: Vec<(Uuid, WorkspaceConnectionListing)>) -> Self {
        Self { entries }
    }
}

#[async_trait]
impl WorkspaceConnectionRepository for WorkspaceConnectionsStub {
    async fn insert_connection(
        &self,
        _new_connection: NewWorkspaceConnection,
    ) -> Result<WorkspaceConnection, sqlx::Error> {
        Err(sqlx::Error::RowNotFound)
    }

    async fn find_by_id(
        &self,
        _connection_id: Uuid,
    ) -> Result<Option<WorkspaceConnection>, sqlx::Error> {
        Ok(None)
    }

    async fn find_by_workspace_and_provider(
        &self,
        _workspace_id: Uuid,
        _provider: ConnectedOAuthProvider,
    ) -> Result<Option<WorkspaceConnection>, sqlx::Error> {
        Ok(None)
    }

    async fn list_for_workspace(
        &self,
        workspace_id: Uuid,
    ) -> Result<Vec<WorkspaceConnectionListing>, sqlx::Error> {
        Ok(self
            .entries
            .iter()
            .filter(|(_, record)| record.workspace_id == workspace_id)
            .map(|(_, record)| record.clone())
            .collect())
    }

    async fn list_for_user_memberships(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<WorkspaceConnectionListing>, sqlx::Error> {
        Ok(self
            .entries
            .iter()
            .filter(|(member_id, _)| *member_id == user_id)
            .map(|(_, record)| record.clone())
            .collect())
    }

    async fn update_tokens_for_creator(
        &self,
        _creator_id: Uuid,
        _provider: ConnectedOAuthProvider,
        _access_token: String,
        _refresh_token: String,
        _expires_at: OffsetDateTime,
        _account_email: String,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn update_tokens(
        &self,
        _connection_id: Uuid,
        _access_token: String,
        _refresh_token: String,
        _expires_at: OffsetDateTime,
    ) -> Result<WorkspaceConnection, sqlx::Error> {
        Err(sqlx::Error::RowNotFound)
    }

    async fn delete_connection(&self, _connection_id: Uuid) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn mark_connections_stale_for_creator(
        &self,
        _creator_id: Uuid,
        _provider: ConnectedOAuthProvider,
    ) -> Result<
        Vec<crate::db::workspace_connection_repository::StaleWorkspaceConnection>,
        sqlx::Error,
    > {
        Ok(Vec::new())
    }

    async fn record_audit_event(
        &self,
        _event: NewWorkspaceAuditEvent,
    ) -> Result<WorkspaceAuditEvent, sqlx::Error> {
        Err(sqlx::Error::RowNotFound)
    }
}

#[tokio::test]
async fn list_connections_returns_personal_and_workspace_entries() {
    let config = stub_config();
    let user_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    let personal_expires_at = now + Duration::hours(1);
    let personal_updated_at = now - Duration::minutes(5);

    let encrypted_access = encrypt_secret(&config.oauth.token_encryption_key, "access-token")
        .expect("encrypt access token");
    let encrypted_refresh = encrypt_secret(&config.oauth.token_encryption_key, "refresh-token")
        .expect("encrypt refresh token");

    let personal_token_id = Uuid::new_v4();
    let personal_token = UserOAuthToken {
        id: personal_token_id,
        user_id,
        provider: ConnectedOAuthProvider::Google,
        access_token: encrypted_access,
        refresh_token: encrypted_refresh,
        expires_at: personal_expires_at,
        account_email: "user@example.com".into(),
        is_shared: false,
        created_at: personal_updated_at - Duration::hours(1),
        updated_at: personal_updated_at,
    };

    let workspace_connection_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let workspace_expires_at = personal_expires_at + Duration::hours(4);
    let workspace_updated_at = now - Duration::minutes(2);
    let listing = WorkspaceConnectionListing {
        id: workspace_connection_id,
        workspace_id,
        workspace_name: "Shared Workspace".into(),
        provider: ConnectedOAuthProvider::Google,
        account_email: "shared@example.com".into(),
        expires_at: workspace_expires_at,
        shared_by_first_name: Some("Alice ".into()),
        shared_by_last_name: Some(" Example".into()),
        shared_by_email: Some(" alice@example.com ".into()),
        updated_at: workspace_updated_at,
        requires_reconnect: false,
    };

    let workspace_repo: Arc<dyn WorkspaceConnectionRepository> =
        Arc::new(WorkspaceConnectionsStub::new(vec![(user_id, listing)]));

    let token_repo: Arc<dyn UserOAuthTokenRepository> = Arc::new(TokenRepo {
        tokens: vec![personal_token],
    });
    let encryption_key = Arc::new(config.oauth.token_encryption_key.clone());
    let oauth_client = Arc::new(reqwest::Client::new());
    let oauth_service = Arc::new(OAuthAccountService::new(
        token_repo,
        workspace_repo.clone(),
        encryption_key,
        oauth_client,
        &config.oauth,
    ));

    let mut state = stub_state(config.clone());
    state.oauth_accounts = oauth_service;
    state.workspace_connection_repo = workspace_repo;

    let claims = Claims {
        id: user_id.to_string(),
        ..stub_claims()
    };

    let response = list_connections(
        State(state),
        AuthSession(claims),
        Query(ListConnectionsQuery {
            workspace: Some(workspace_id),
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let json: Value = serde_json::from_slice(&body).expect("response json");

    assert_eq!(json["success"].as_bool(), Some(true));
    let personal = json["personal"].as_array().expect("personal array");
    assert_eq!(personal.len(), 1);
    let personal_entry = &personal[0];
    let expected_personal_id = personal_token_id.to_string();
    let expected_personal_expires = personal_expires_at
        .format(&Rfc3339)
        .expect("format personal expires");
    assert_eq!(personal_entry["provider"].as_str(), Some("google"));
    assert_eq!(
        personal_entry["id"].as_str(),
        Some(expected_personal_id.as_str())
    );
    assert_eq!(
        personal_entry["accountEmail"].as_str(),
        Some("user@example.com")
    );
    assert_eq!(personal_entry["isShared"].as_bool(), Some(false));
    assert_eq!(
        personal_entry["expiresAt"].as_str(),
        Some(expected_personal_expires.as_str())
    );
    assert_eq!(personal_entry["requiresReconnect"].as_bool(), Some(false));
    let expected_personal_refreshed = personal_updated_at
        .format(&Rfc3339)
        .expect("format personal refreshed");
    assert_eq!(
        personal_entry["lastRefreshedAt"].as_str(),
        Some(expected_personal_refreshed.as_str())
    );

    let workspace = json["workspace"].as_array().expect("workspace array");
    assert_eq!(workspace.len(), 1);
    let workspace_entry = &workspace[0];
    let expected_workspace_id = workspace_connection_id.to_string();
    let expected_workspace_uuid = workspace_id.to_string();
    let expected_workspace_expires = workspace_expires_at
        .format(&Rfc3339)
        .expect("format workspace expires");
    assert_eq!(workspace_entry["provider"].as_str(), Some("google"));
    assert_eq!(
        workspace_entry["id"].as_str(),
        Some(expected_workspace_id.as_str())
    );
    assert_eq!(
        workspace_entry["workspaceId"].as_str(),
        Some(expected_workspace_uuid.as_str())
    );
    assert_eq!(
        workspace_entry["workspaceName"].as_str(),
        Some("Shared Workspace")
    );
    assert_eq!(
        workspace_entry["accountEmail"].as_str(),
        Some("shared@example.com")
    );
    assert_eq!(
        workspace_entry["sharedByName"].as_str(),
        Some("Alice Example")
    );
    assert_eq!(
        workspace_entry["sharedByEmail"].as_str(),
        Some("alice@example.com")
    );
    assert_eq!(
        workspace_entry["expiresAt"].as_str(),
        Some(expected_workspace_expires.as_str())
    );
    let expected_workspace_refreshed = workspace_updated_at
        .format(&Rfc3339)
        .expect("format workspace refreshed");
    assert_eq!(
        workspace_entry["lastRefreshedAt"].as_str(),
        Some(expected_workspace_refreshed.as_str())
    );
    assert_eq!(workspace_entry["requiresReconnect"].as_bool(), Some(false));
}

#[tokio::test]
async fn list_connections_without_workspace_excludes_shared_entries() {
    let config = stub_config();
    let user_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    let personal_expires_at = now + Duration::hours(1);

    let encrypted_access = encrypt_secret(&config.oauth.token_encryption_key, "access-token")
        .expect("encrypt access token");
    let encrypted_refresh = encrypt_secret(&config.oauth.token_encryption_key, "refresh-token")
        .expect("encrypt refresh token");

    let personal_token = UserOAuthToken {
        id: Uuid::new_v4(),
        user_id,
        provider: ConnectedOAuthProvider::Google,
        access_token: encrypted_access,
        refresh_token: encrypted_refresh,
        expires_at: personal_expires_at,
        account_email: "user@example.com".into(),
        is_shared: false,
        created_at: now - Duration::hours(2),
        updated_at: now - Duration::minutes(10),
    };

    let workspace_connection_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let workspace_listing = WorkspaceConnectionListing {
        id: workspace_connection_id,
        workspace_id,
        workspace_name: "Shared Workspace".into(),
        provider: ConnectedOAuthProvider::Google,
        account_email: "shared@example.com".into(),
        expires_at: personal_expires_at + Duration::hours(4),
        shared_by_first_name: Some("Taylor".into()),
        shared_by_last_name: Some("Admin".into()),
        shared_by_email: Some("taylor@example.com".into()),
        updated_at: now - Duration::minutes(3),
        requires_reconnect: false,
    };

    let workspace_repo: Arc<dyn WorkspaceConnectionRepository> = Arc::new(
        WorkspaceConnectionsStub::new(vec![(user_id, workspace_listing)]),
    );
    let token_repo: Arc<dyn UserOAuthTokenRepository> = Arc::new(TokenRepo {
        tokens: vec![personal_token],
    });
    let encryption_key = Arc::new(config.oauth.token_encryption_key.clone());
    let oauth_client = Arc::new(reqwest::Client::new());
    let oauth_service = Arc::new(OAuthAccountService::new(
        token_repo,
        workspace_repo.clone(),
        encryption_key,
        oauth_client,
        &config.oauth,
    ));

    let mut state = stub_state(config.clone());
    state.oauth_accounts = oauth_service;
    state.workspace_connection_repo = workspace_repo;

    let claims = Claims {
        id: user_id.to_string(),
        ..stub_claims()
    };

    let response = list_connections(
        State(state),
        AuthSession(claims),
        Query(ListConnectionsQuery::default()),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let json: Value = serde_json::from_slice(&body).expect("response json");

    let workspace = json["workspace"].as_array().expect("workspace array");
    assert!(workspace.is_empty());
    let personal = json["personal"].as_array().expect("personal array");
    assert_eq!(personal.len(), 1);
}

#[tokio::test]
async fn list_connections_includes_workspace_reconnect_flag() {
    let config = stub_config();
    let user_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    let workspace_id = Uuid::new_v4();
    let connection_id = Uuid::new_v4();

    let listing = WorkspaceConnectionListing {
        id: connection_id,
        workspace_id,
        workspace_name: "Requires Attention".into(),
        provider: ConnectedOAuthProvider::Microsoft,
        account_email: "shared@example.com".into(),
        expires_at: now - Duration::hours(1),
        shared_by_first_name: Some("Taylor".into()),
        shared_by_last_name: Some("Admin".into()),
        shared_by_email: Some("taylor@example.com".into()),
        updated_at: now - Duration::minutes(5),
        requires_reconnect: true,
    };

    let workspace_repo: Arc<dyn WorkspaceConnectionRepository> =
        Arc::new(WorkspaceConnectionsStub::new(vec![(user_id, listing)]));

    let token_repo: Arc<dyn UserOAuthTokenRepository> = Arc::new(TokenRepo { tokens: Vec::new() });
    let encryption_key = Arc::new(config.oauth.token_encryption_key.clone());
    let oauth_client = Arc::new(reqwest::Client::new());
    let oauth_service = Arc::new(OAuthAccountService::new(
        token_repo,
        workspace_repo.clone(),
        encryption_key,
        oauth_client,
        &config.oauth,
    ));

    let mut state = stub_state(config.clone());
    state.oauth_accounts = oauth_service;
    state.workspace_connection_repo = workspace_repo;

    let claims = Claims {
        id: user_id.to_string(),
        ..stub_claims()
    };

    let response = list_connections(
        State(state),
        AuthSession(claims),
        Query(ListConnectionsQuery {
            workspace: Some(workspace_id),
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let json: Value = serde_json::from_slice(&body).expect("response json");

    let workspace = json["workspace"].as_array().expect("workspace array");
    assert_eq!(workspace.len(), 1);
    let entry = &workspace[0];
    assert_eq!(entry["requiresReconnect"].as_bool(), Some(true));
    assert_eq!(entry["workspaceName"].as_str(), Some("Requires Attention"));
}

#[tokio::test]
async fn refresh_connection_returns_last_refreshed_timestamp() {
    let config = stub_config();
    let user_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    let expires_at = now + Duration::hours(2);
    let updated_at = now - Duration::minutes(1);

    let encrypted_access = encrypt_secret(&config.oauth.token_encryption_key, "access-token")
        .expect("encrypt access token");
    let encrypted_refresh = encrypt_secret(&config.oauth.token_encryption_key, "refresh-token")
        .expect("encrypt refresh token");

    let token_repo: Arc<dyn UserOAuthTokenRepository> = Arc::new(TokenRepo {
        tokens: vec![UserOAuthToken {
            id: Uuid::new_v4(),
            user_id,
            provider: ConnectedOAuthProvider::Google,
            access_token: encrypted_access,
            refresh_token: encrypted_refresh,
            expires_at,
            account_email: "user@example.com".into(),
            is_shared: false,
            created_at: updated_at - Duration::hours(1),
            updated_at,
        }],
    });

    let workspace_repo: Arc<dyn WorkspaceConnectionRepository> =
        Arc::new(WorkspaceConnectionsStub::new(Vec::new()));

    let encryption_key = Arc::new(config.oauth.token_encryption_key.clone());
    let oauth_client = Arc::new(reqwest::Client::new());
    let oauth_service = Arc::new(OAuthAccountService::new(
        token_repo,
        workspace_repo.clone(),
        encryption_key,
        oauth_client,
        &config.oauth,
    ));

    let mut state = stub_state(config.clone());
    state.oauth_accounts = oauth_service;
    state.workspace_connection_repo = workspace_repo;

    let claims = Claims {
        id: user_id.to_string(),
        ..stub_claims()
    };

    let response = refresh_connection(
        State(state),
        AuthSession(claims),
        Path("google".to_string()),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let json: Value = serde_json::from_slice(&body).expect("response json");

    assert_eq!(json["success"].as_bool(), Some(true));
    assert_eq!(json["requires_reconnect"].as_bool(), Some(false));
    assert_eq!(json["account_email"].as_str(), Some("user@example.com"));
    let expected_expires = expires_at
        .format(&Rfc3339)
        .expect("format expires timestamp");
    assert_eq!(json["expires_at"].as_str(), Some(expected_expires.as_str()));
    let expected_updated = updated_at
        .format(&Rfc3339)
        .expect("format updated timestamp");
    assert_eq!(
        json["last_refreshed_at"].as_str(),
        Some(expected_updated.as_str())
    );
}

#[tokio::test]
async fn refresh_connection_returns_conflict_when_revoked() {
    let config = stub_config();
    let user_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();

    let encrypted_access = encrypt_secret(&config.oauth.token_encryption_key, "access-token")
        .expect("encrypt access token");
    let encrypted_refresh = encrypt_secret(&config.oauth.token_encryption_key, "refresh-token")
        .expect("encrypt refresh token");

    let token_repo: Arc<dyn UserOAuthTokenRepository> = Arc::new(TokenRepo {
        tokens: vec![UserOAuthToken {
            id: Uuid::new_v4(),
            user_id,
            provider: ConnectedOAuthProvider::Google,
            access_token: encrypted_access,
            refresh_token: encrypted_refresh,
            expires_at: now,
            account_email: "owner@example.com".into(),
            is_shared: false,
            created_at: now - Duration::hours(1),
            updated_at: now - Duration::minutes(2),
        }],
    });

    let workspace_repo: Arc<dyn WorkspaceConnectionRepository> =
        Arc::new(WorkspaceConnectionsStub::new(Vec::new()));

    let mut oauth_service = OAuthAccountService::new(
        token_repo,
        workspace_repo.clone(),
        Arc::new(config.oauth.token_encryption_key.clone()),
        Arc::new(reqwest::Client::new()),
        &config.oauth,
    );

    fn revoked_override(
        provider: ConnectedOAuthProvider,
        _token: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError> {
        Err(OAuthAccountError::TokenRevoked { provider })
    }

    oauth_service.set_refresh_override(Some(Arc::new(revoked_override)));

    let mut state = stub_state(config.clone());
    state.oauth_accounts = Arc::new(oauth_service);
    state.workspace_connection_repo = workspace_repo;

    let claims = Claims {
        id: user_id.to_string(),
        ..stub_claims()
    };

    let response = refresh_connection(
        State(state),
        AuthSession(claims),
        Path("google".to_string()),
    )
    .await;

    assert_eq!(response.status(), StatusCode::CONFLICT);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let json: Value = serde_json::from_slice(&body).expect("response json");

    assert_eq!(json["success"].as_bool(), Some(false));
    assert_eq!(json["requires_reconnect"].as_bool(), Some(true));
    assert!(json["message"].as_str().is_some());
}

#[async_trait]
impl WorkspaceRepository for MembershipWorkspaceRepo {
    async fn create_workspace(
        &self,
        _name: &str,
        _created_by: Uuid,
        _plan: &str,
    ) -> Result<Workspace, Error> {
        unimplemented!()
    }

    async fn update_workspace_name(
        &self,
        _workspace_id: Uuid,
        _name: &str,
    ) -> Result<Workspace, Error> {
        unimplemented!()
    }

    async fn update_workspace_plan(
        &self,
        _workspace_id: Uuid,
        _plan: &str,
    ) -> Result<Workspace, Error> {
        unimplemented!()
    }

    async fn find_workspace(&self, _workspace_id: Uuid) -> Result<Option<Workspace>, Error> {
        unimplemented!()
    }

    async fn add_member(
        &self,
        _workspace_id: Uuid,
        _user_id: Uuid,
        _role: WorkspaceRole,
    ) -> Result<(), Error> {
        unimplemented!()
    }

    async fn set_member_role(
        &self,
        _workspace_id: Uuid,
        _user_id: Uuid,
        _role: WorkspaceRole,
    ) -> Result<(), Error> {
        unimplemented!()
    }

    async fn remove_member(&self, _workspace_id: Uuid, _user_id: Uuid) -> Result<(), Error> {
        unimplemented!()
    }

    async fn leave_workspace(&self, _workspace_id: Uuid, _user_id: Uuid) -> Result<(), Error> {
        unimplemented!()
    }

    async fn revoke_member(
        &self,
        _workspace_id: Uuid,
        _member_id: Uuid,
        _revoked_by: Uuid,
        _reason: Option<&str>,
    ) -> Result<(), Error> {
        unimplemented!()
    }

    async fn list_members(
        &self,
        _workspace_id: Uuid,
    ) -> Result<Vec<crate::models::workspace::WorkspaceMember>, Error> {
        unimplemented!()
    }

    async fn list_memberships_for_user(
        &self,
        _user_id: Uuid,
    ) -> Result<Vec<WorkspaceMembershipSummary>, Error> {
        Ok(self.memberships.clone())
    }

    async fn list_user_workspaces(
        &self,
        _user_id: Uuid,
    ) -> Result<Vec<WorkspaceMembershipSummary>, Error> {
        Ok(self.memberships.clone())
    }

    async fn create_workspace_invitation(
        &self,
        _workspace_id: Uuid,
        _email: &str,
        _role: WorkspaceRole,
        _token: &str,
        _expires_at: OffsetDateTime,
        _created_by: Uuid,
    ) -> Result<crate::models::workspace::WorkspaceInvitation, Error> {
        unimplemented!()
    }

    async fn list_workspace_invitations(
        &self,
        _workspace_id: Uuid,
    ) -> Result<Vec<crate::models::workspace::WorkspaceInvitation>, Error> {
        unimplemented!()
    }

    async fn revoke_workspace_invitation(&self, _invite_id: Uuid) -> Result<(), Error> {
        unimplemented!()
    }

    async fn find_invitation_by_token(
        &self,
        _token: &str,
    ) -> Result<Option<crate::models::workspace::WorkspaceInvitation>, Error> {
        unimplemented!()
    }

    async fn mark_invitation_accepted(&self, _invite_id: Uuid) -> Result<(), Error> {
        unimplemented!()
    }

    async fn mark_invitation_declined(&self, _invite_id: Uuid) -> Result<(), Error> {
        unimplemented!()
    }

    async fn list_pending_invitations_for_email(
        &self,
        _email: &str,
    ) -> Result<Vec<crate::models::workspace::WorkspaceInvitation>, Error> {
        unimplemented!()
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
        iss: String::new(),
        aud: String::new(),
        token_use: TokenUse::Access,
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
    assert_eq!(parse_provider("slack"), Some(ConnectedOAuthProvider::Slack));
    assert_eq!(parse_provider("unknown"), None);
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

    let response = google_connect_start(
        State(state),
        AuthSession(claims),
        Query(ConnectQuery::default()),
        CookieJar::new(),
    )
    .await;

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

    let response = google_connect_start(
        State(state),
        AuthSession(claims),
        Query(ConnectQuery::default()),
        CookieJar::new(),
    )
    .await;

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

#[tokio::test]
async fn solo_plan_slack_start_redirects_with_upgrade_message() {
    let config = stub_config();
    let state = stub_state(config.clone());
    let claims = Claims {
        plan: Some("solo".into()),
        ..stub_claims()
    };

    let response = slack_connect_start(
        State(state),
        AuthSession(claims),
        Query(ConnectQuery::default()),
        CookieJar::new(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let location = response
        .headers()
        .get(header::LOCATION)
        .expect("location header present")
        .to_str()
        .unwrap();
    assert!(location.contains("connected=false"));
    assert!(location.contains("provider=slack"));
}

#[tokio::test]
async fn workspace_plan_slack_start_sets_state_cookie() {
    let config = stub_config();
    let state = stub_state(config.clone());
    let claims = Claims {
        plan: Some("workspace".into()),
        ..stub_claims()
    };

    let response = slack_connect_start(
        State(state),
        AuthSession(claims),
        Query(ConnectQuery::default()),
        CookieJar::new(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let cookies = response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|value| value.to_str().unwrap())
        .collect::<Vec<_>>();
    assert!(cookies
        .iter()
        .any(|cookie| cookie.contains(SLACK_STATE_COOKIE)));
}

#[tokio::test]
async fn joined_workspace_member_with_solo_claims_can_connect() {
    let config = stub_config();
    let workspace_id = Uuid::new_v4();
    let membership = workspace_membership(workspace_id, WorkspaceRole::Admin, "workspace");
    let state = stub_state_with_workspace_repo(
        config.clone(),
        Arc::new(MembershipWorkspaceRepo::new(vec![membership])),
    );
    let claims = Claims {
        id: Uuid::new_v4().to_string(),
        plan: Some("solo".into()),
        ..stub_claims()
    };

    let response = google_connect_start(
        State(state),
        AuthSession(claims),
        Query(ConnectQuery {
            workspace: Some(workspace_id),
        }),
        CookieJar::new(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let location = response
        .headers()
        .get(header::LOCATION)
        .expect("location header present")
        .to_str()
        .unwrap();
    assert!(location.contains("accounts.google.com"));
}

#[tokio::test]
async fn workspace_viewer_is_blocked_from_connecting() {
    let config = stub_config();
    let workspace_id = Uuid::new_v4();
    let membership = workspace_membership(workspace_id, WorkspaceRole::Viewer, "workspace");
    let state = stub_state_with_workspace_repo(
        config.clone(),
        Arc::new(MembershipWorkspaceRepo::new(vec![membership])),
    );
    let claims = Claims {
        id: Uuid::new_v4().to_string(),
        plan: Some("workspace".into()),
        ..stub_claims()
    };

    let response = google_connect_start(
        State(state),
        AuthSession(claims),
        Query(ConnectQuery {
            workspace: Some(workspace_id),
        }),
        CookieJar::new(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let location = response
        .headers()
        .get(header::LOCATION)
        .expect("location header present")
        .to_str()
        .unwrap();
    assert!(location.contains("connected=false"));
    let expected = encode("Workspace viewers cannot connect OAuth accounts for this workspace.");
    assert!(location.contains(expected.as_ref()));
}
