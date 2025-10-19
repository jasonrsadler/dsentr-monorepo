use async_trait::async_trait;
use axum::{
    extract::{Query, State},
    http::{header, StatusCode},
};
use axum_extra::extract::cookie::CookieJar;
use std::sync::Arc;

use crate::config::{Config, OAuthProviderConfig, OAuthSettings};
use crate::db::mock_db::{MockDb, NoopWorkflowRepository, NoopWorkspaceRepository};
use crate::db::workspace_repository::WorkspaceRepository;
use crate::models::user::UserRole;
use crate::models::workspace::{Workspace, WorkspaceMembershipSummary, WorkspaceRole};
use crate::routes::auth::{claims::Claims, session::AuthSession};
use crate::services::{
    oauth::{
        account_service::{OAuthAccountError, OAuthAccountService},
        github::mock_github_oauth::MockGitHubOAuth,
        google::mock_google_oauth::MockGoogleOAuth,
    },
    smtp_mailer::MockMailer,
};
use crate::state::AppState;
use sqlx::Error;
use time::OffsetDateTime;
use urlencoding::encode;
use uuid::Uuid;

use super::{
    connect::{google_connect_start, ConnectQuery},
    helpers::{
        build_state_cookie, default_provider_statuses, error_message_for_redirect, handle_callback,
        parse_provider, CallbackQuery, GOOGLE_STATE_COOKIE,
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
            token_encryption_key: vec![0u8; 32],
        },
    })
}

fn stub_state(config: Arc<Config>) -> AppState {
    AppState {
        db: Arc::new(MockDb::default()),
        workflow_repo: Arc::new(NoopWorkflowRepository),
        workspace_repo: Arc::new(NoopWorkspaceRepository),
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
