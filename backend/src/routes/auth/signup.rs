use axum::{
    extract::{Json, State},
    response::{IntoResponse, Response},
};
use rand::{distr::Alphanumeric, Rng};
extern crate serde;
use time::{Duration, OffsetDateTime};

use crate::utils::password::hash_password;
use crate::{
    models::{
        signup::{SignupInviteDecision, SignupPayload},
        user::OauthProvider,
        workspace::{WorkspaceRole, INVITATION_STATUS_PENDING, WORKSPACE_PLAN_SOLO},
    },
    responses::JsonResponse,
    state,
};

const INVALID_INVITE_MESSAGE: &str = "Invalid or expired invite link";

fn default_workspace_name(payload: &SignupPayload) -> String {
    if let Some(company) = payload
        .company_name
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return format!("{} Workspace", company);
    }

    let first = payload.first_name.trim();
    if !first.is_empty() {
        let suffix = if first.ends_with('s') { "'" } else { "'s" };
        return format!("{}{} Workspace", first, suffix);
    }

    "My Workspace".to_string()
}

pub async fn handle_signup(
    State(state): State<state::AppState>,
    Json(payload): Json<SignupPayload>,
) -> Response {
    let repo = &state.db;
    let workspace_repo = &state.workspace_repo;

    let mut payload = payload;
    payload.email = payload.email.trim().to_lowercase();

    if let Ok(true) = repo.is_email_taken(&payload.email).await {
        return JsonResponse::conflict("User already registered").into_response();
    }

    let invite_token = payload
        .invite_token
        .as_ref()
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty());
    let invite_decision = payload
        .invite_decision
        .unwrap_or(SignupInviteDecision::Join);

    let mut invite_record = None;
    if let Some(token) = invite_token.as_ref() {
        match workspace_repo.find_invitation_by_token(token).await {
            Ok(Some(invite)) => {
                let now = OffsetDateTime::now_utc();
                let email_mismatch = !invite.email.eq_ignore_ascii_case(&payload.email);
                if invite.status != INVITATION_STATUS_PENDING
                    || invite.revoked_at.is_some()
                    || invite.accepted_at.is_some()
                    || invite.declined_at.is_some()
                    || invite.expires_at <= now
                    || email_mismatch
                {
                    return JsonResponse::bad_request(INVALID_INVITE_MESSAGE).into_response();
                }
                invite_record = Some(invite);
            }
            Ok(None) => {
                return JsonResponse::bad_request(INVALID_INVITE_MESSAGE).into_response();
            }
            Err(err) => {
                eprintln!("Failed to load invite: {:?}", err);
                return JsonResponse::server_error("Could not validate invitation").into_response();
            }
        }
    }

    let password_hash = match hash_password(&payload.password) {
        Ok(hash) => hash,
        Err(_) => return JsonResponse::server_error("Password hashing failed").into_response(),
    };

    let provider = payload
        .provider
        .as_ref()
        .copied()
        .unwrap_or(OauthProvider::Email);
    let user_id = match repo.create_user(&payload, &password_hash, provider).await {
        Ok(id) => id,
        Err(e) => {
            eprintln!("Failed to insert user: {:?}", e);
            return JsonResponse::server_error("Could not create user").into_response();
        }
    };

    let token: String = rand::rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    let expires_at = OffsetDateTime::now_utc() + Duration::hours(24);

    if invite_record.is_none() || matches!(invite_decision, SignupInviteDecision::Decline) {
        let workspace_name = default_workspace_name(&payload);
        let workspace = match workspace_repo
            .create_workspace(&workspace_name, user_id, WORKSPACE_PLAN_SOLO)
            .await
        {
            Ok(workspace) => workspace,
            Err(err) => {
                eprintln!("Failed to create default workspace: {:?}", err);
                let _ = repo.cleanup_user_and_token(user_id, &token).await;
                return JsonResponse::server_error("Could not provision workspace").into_response();
            }
        };

        if let Err(err) = workspace_repo
            .add_member(workspace.id, user_id, WorkspaceRole::Owner)
            .await
        {
            eprintln!("Failed to attach owner membership: {:?}", err);
            let _ = repo.cleanup_user_and_token(user_id, &token).await;
            return JsonResponse::server_error("Could not provision workspace").into_response();
        }
    }

    if let Some(invite) = invite_record.clone() {
        match invite_decision {
            SignupInviteDecision::Join => {
                if let Err(err) = workspace_repo
                    .add_member(invite.workspace_id, user_id, invite.role)
                    .await
                {
                    eprintln!("Failed to add invited member: {:?}", err);
                    let _ = repo.cleanup_user_and_token(user_id, &token).await;
                    return JsonResponse::server_error("Could not attach workspace membership")
                        .into_response();
                }
                if let Err(err) = workspace_repo.mark_invitation_accepted(invite.id).await {
                    eprintln!("Failed to mark invite accepted: {:?}", err);
                }
            }
            SignupInviteDecision::Decline => {
                if let Err(err) = workspace_repo.mark_invitation_declined(invite.id).await {
                    eprintln!("Failed to mark invite declined: {:?}", err);
                }
            }
        }
    }

    if let Err(e) = repo
        .insert_verification_token(user_id, &token, expires_at)
        .await
    {
        eprintln!("Failed to insert verification token: {:?}", e);
        let _ = repo.cleanup_user_and_token(user_id, &token).await;
        return JsonResponse::server_error("Could not create verification token").into_response();
    }

    if let Err(err) = state
        .mailer
        .send_verification_email(&payload.email, &token)
        .await
    {
        eprintln!("Failed to send verification email: {}", err);
        let _ = repo.cleanup_user_and_token(user_id, &token).await;
        return JsonResponse::server_error("Failed to send verification email").into_response();
    }

    JsonResponse::success("User created. Check your email to verify your account.").into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
    };
    use std::{
        sync::{Arc, Mutex},
        usize,
    };
    use tower::ServiceExt;
    use uuid::Uuid;

    use crate::{
        config::{Config, OAuthProviderConfig, OAuthSettings},
        db::{
            mock_db::{NoopWorkflowRepository, NoopWorkspaceRepository},
            user_repository::{UserId, UserRepository},
            workspace_repository::WorkspaceRepository,
        },
        models::{
            signup::{SignupInviteDecision, SignupPayload},
            user::{OauthProvider, PublicUser, User, UserRole},
            workspace::{
                Workspace, WorkspaceInvitation, WorkspaceMembershipSummary, WorkspaceRole,
                INVITATION_STATUS_PENDING, WORKSPACE_PLAN_SOLO,
            },
        },
        services::{
            oauth::{
                account_service::OAuthAccountService, github::mock_github_oauth::MockGitHubOAuth,
                google::mock_google_oauth::MockGoogleOAuth,
            },
            smtp_mailer::{Mailer, MockMailer},
        },
        state::AppState,
    };
    use reqwest::Client;

    fn test_config() -> Arc<Config> {
        Arc::new(Config {
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
                token_encryption_key: vec![0u8; 32],
            },
        })
    }

    struct MockRepo {
        email_taken: bool,
        fail_create_user: bool,
        fail_insert_token: bool,
        cleaned_up: Arc<Mutex<bool>>,
    }

    #[async_trait]
    impl UserRepository for MockRepo {
        async fn is_email_taken(&self, _email: &str) -> Result<bool, sqlx::Error> {
            Ok(self.email_taken)
        }

        async fn create_user(
            &self,
            _payload: &SignupPayload,
            _hashed_password: &str,
            _provider: OauthProvider,
        ) -> Result<Uuid, sqlx::Error> {
            if self.fail_create_user {
                Err(sqlx::Error::RowNotFound)
            } else {
                Ok(Uuid::new_v4())
            }
        }

        async fn insert_verification_token(
            &self,
            _user_id: Uuid,
            _token: &str,
            _expires_at: OffsetDateTime,
        ) -> Result<(), sqlx::Error> {
            if self.fail_insert_token {
                Err(sqlx::Error::RowNotFound)
            } else {
                Ok(())
            }
        }

        async fn cleanup_user_and_token(
            &self,
            _user_id: Uuid,
            _token: &str,
        ) -> Result<(), sqlx::Error> {
            *self.cleaned_up.lock().unwrap() = true;
            Ok(())
        }

        // === Stubbed methods below ===

        async fn find_user_id_by_email(&self, _email: &str) -> Result<Option<UserId>, sqlx::Error> {
            Ok(Some(UserId { id: Uuid::new_v4() }))
        }

        async fn insert_password_reset_token(
            &self,
            _user_id: Uuid,
            _token: &str,
            _expires_at: OffsetDateTime,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn find_user_by_email(&self, _email: &str) -> Result<Option<User>, sqlx::Error> {
            Ok(Some(User {
                id: Uuid::new_v4(),
                email: "test@example.com".into(),
                password_hash: "hashed".into(),
                first_name: "Test".into(),
                last_name: "User".into(),
                role: Some(UserRole::User),
                created_at: OffsetDateTime::now_utc(),
                plan: None,
                company_name: None,
                oauth_provider: Some(OauthProvider::Email),
                onboarded_at: None,
            }))
        }

        async fn create_user_with_oauth(
            &self,
            _email: &str,
            _first_name: &str,
            _last_name: &str,
            _provider: OauthProvider,
        ) -> Result<User, sqlx::Error> {
            Ok(User {
                id: Uuid::new_v4(),
                email: "test@example.com".into(),
                password_hash: "hashed".into(),
                first_name: "Test".into(),
                last_name: "User".into(),
                role: Some(UserRole::User),
                created_at: OffsetDateTime::now_utc(),
                plan: None,
                company_name: None,
                oauth_provider: Some(OauthProvider::Email),
                onboarded_at: None,
            })
        }

        async fn find_public_user_by_id(
            &self,
            _user_id: Uuid,
        ) -> Result<Option<PublicUser>, sqlx::Error> {
            Ok(Some(PublicUser {
                id: Uuid::new_v4(),
                email: "test@example.com".into(),
                first_name: "Test".into(),
                last_name: "User".into(),
                plan: None,
                company_name: None,
                role: Some(UserRole::User),
                onboarded_at: None,
            }))
        }

        async fn verify_password_reset_token(
            &self,
            _token: &str,
        ) -> Result<Option<Uuid>, sqlx::Error> {
            Ok(Some(Uuid::new_v4()))
        }

        async fn update_user_password(
            &self,
            _user_id: Uuid,
            _hashed_password: &str,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn mark_password_reset_token_used(&self, _token: &str) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn mark_verification_token_used(
            &self,
            _token: &str,
            _: OffsetDateTime,
        ) -> Result<Option<Uuid>, sqlx::Error> {
            Ok(Some(Uuid::new_v4()))
        }

        async fn set_user_verified(&self, _user_id: Uuid) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn insert_early_access_email(&self, _email: &str) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn get_user_settings(&self, _: Uuid) -> Result<serde_json::Value, sqlx::Error> {
            Ok(serde_json::Value::Object(Default::default()))
        }

        async fn update_user_settings(
            &self,
            _: Uuid,
            _: serde_json::Value,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn update_user_plan(&self, _: Uuid, _: &str) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn mark_workspace_onboarded(
            &self,
            _: Uuid,
            _: OffsetDateTime,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }
    }

    #[derive(Default)]
    struct RecordingWorkspaceRepo {
        invite: Mutex<Option<WorkspaceInvitation>>,
        created: Arc<Mutex<Vec<Workspace>>>,
        add_calls: Arc<Mutex<Vec<(Uuid, Uuid, WorkspaceRole)>>>,
        accepted: Arc<Mutex<Vec<Uuid>>>,
        declined: Arc<Mutex<Vec<Uuid>>>,
        fail_create_workspace: bool,
        fail_join_membership: bool,
    }

    impl RecordingWorkspaceRepo {
        fn with_invite(invite: WorkspaceInvitation) -> Self {
            Self {
                invite: Mutex::new(Some(invite)),
                ..Default::default()
            }
        }

        fn record(
            &self,
        ) -> (
            Vec<Workspace>,
            Vec<(Uuid, Uuid, WorkspaceRole)>,
            Vec<Uuid>,
            Vec<Uuid>,
        ) {
            (
                self.created.lock().unwrap().clone(),
                self.add_calls.lock().unwrap().clone(),
                self.accepted.lock().unwrap().clone(),
                self.declined.lock().unwrap().clone(),
            )
        }
    }

    #[async_trait]
    impl WorkspaceRepository for RecordingWorkspaceRepo {
        async fn create_workspace(
            &self,
            name: &str,
            created_by: Uuid,
            plan: &str,
        ) -> Result<Workspace, sqlx::Error> {
            if self.fail_create_workspace {
                return Err(sqlx::Error::Protocol("fail_create_workspace".into()));
            }
            let workspace = Workspace {
                id: Uuid::new_v4(),
                name: name.to_string(),
                created_by,
                owner_id: created_by,
                plan: plan.to_string(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
                deleted_at: None,
            };
            self.created.lock().unwrap().push(workspace.clone());
            Ok(workspace)
        }

        async fn update_workspace_name(
            &self,
            workspace_id: Uuid,
            name: &str,
        ) -> Result<Workspace, sqlx::Error> {
            Ok(Workspace {
                id: workspace_id,
                name: name.to_string(),
                created_by: Uuid::nil(),
                owner_id: Uuid::nil(),
                plan: WORKSPACE_PLAN_SOLO.to_string(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
                deleted_at: None,
            })
        }

        async fn find_workspace(
            &self,
            _workspace_id: Uuid,
        ) -> Result<Option<Workspace>, sqlx::Error> {
            Ok(None)
        }

        async fn add_member(
            &self,
            workspace_id: Uuid,
            user_id: Uuid,
            role: WorkspaceRole,
        ) -> Result<(), sqlx::Error> {
            let should_fail = self.fail_join_membership
                && self
                    .invite
                    .lock()
                    .unwrap()
                    .as_ref()
                    .map(|invite| invite.workspace_id == workspace_id)
                    .unwrap_or(false);
            if should_fail {
                return Err(sqlx::Error::Protocol("fail_add_member".into()));
            }
            self.add_calls
                .lock()
                .unwrap()
                .push((workspace_id, user_id, role));
            Ok(())
        }

        async fn set_member_role(
            &self,
            _workspace_id: Uuid,
            _user_id: Uuid,
            _role: WorkspaceRole,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn remove_member(
            &self,
            _workspace_id: Uuid,
            _user_id: Uuid,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn leave_workspace(
            &self,
            _workspace_id: Uuid,
            _user_id: Uuid,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn revoke_member(
            &self,
            _workspace_id: Uuid,
            _member_id: Uuid,
            _revoked_by: Uuid,
            _reason: Option<&str>,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn list_members(
            &self,
            _workspace_id: Uuid,
        ) -> Result<Vec<crate::models::workspace::WorkspaceMember>, sqlx::Error> {
            Ok(vec![])
        }

        async fn list_memberships_for_user(
            &self,
            _user_id: Uuid,
        ) -> Result<Vec<WorkspaceMembershipSummary>, sqlx::Error> {
            Ok(vec![])
        }

        async fn list_user_workspaces(
            &self,
            _user_id: Uuid,
        ) -> Result<Vec<WorkspaceMembershipSummary>, sqlx::Error> {
            Ok(vec![])
        }

        async fn create_workspace_invitation(
            &self,
            _workspace_id: Uuid,
            _email: &str,
            _role: WorkspaceRole,
            _token: &str,
            _expires_at: OffsetDateTime,
            _created_by: Uuid,
        ) -> Result<WorkspaceInvitation, sqlx::Error> {
            unimplemented!()
        }

        async fn list_workspace_invitations(
            &self,
            _workspace_id: Uuid,
        ) -> Result<Vec<WorkspaceInvitation>, sqlx::Error> {
            Ok(vec![])
        }

        async fn revoke_workspace_invitation(&self, _invite_id: Uuid) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn find_invitation_by_token(
            &self,
            token: &str,
        ) -> Result<Option<WorkspaceInvitation>, sqlx::Error> {
            let invite = self.invite.lock().unwrap().clone();
            Ok(invite.filter(|inv| inv.token == token))
        }

        async fn mark_invitation_accepted(&self, invite_id: Uuid) -> Result<(), sqlx::Error> {
            self.accepted.lock().unwrap().push(invite_id);
            Ok(())
        }

        async fn mark_invitation_declined(&self, invite_id: Uuid) -> Result<(), sqlx::Error> {
            self.declined.lock().unwrap().push(invite_id);
            Ok(())
        }

        async fn list_pending_invitations_for_email(
            &self,
            _: &str,
        ) -> Result<Vec<WorkspaceInvitation>, sqlx::Error> {
            Ok(vec![])
        }
    }
    fn test_payload() -> SignupPayload {
        SignupPayload {
            email: "test@example.com".into(),
            password: "password123".into(),
            first_name: "Test".into(),
            last_name: "User".into(),
            provider: None,
            company_name: None,
            country: None,
            tax_id: None,
            invite_token: None,
            invite_decision: None,
        }
    }

    fn invite_fixture(token: &str, email: &str, expires_at: OffsetDateTime) -> WorkspaceInvitation {
        WorkspaceInvitation {
            id: Uuid::new_v4(),
            workspace_id: Uuid::new_v4(),
            email: email.to_string(),
            role: WorkspaceRole::User,
            token: token.to_string(),
            status: INVITATION_STATUS_PENDING.to_string(),
            expires_at,
            created_by: Uuid::new_v4(),
            created_at: OffsetDateTime::now_utc(),
            accepted_at: None,
            revoked_at: None,
            declined_at: None,
        }
    }

    async fn run_signup(
        repo: impl UserRepository + 'static,
        workspace_repo: Arc<dyn WorkspaceRepository>,
        mailer: impl Mailer + 'static,
        payload: SignupPayload,
    ) -> axum::response::Response {
        let app = axum::Router::new()
            .route("/", axum::routing::post(handle_signup))
            .with_state(AppState {
                db: Arc::new(repo),
                workflow_repo: Arc::new(NoopWorkflowRepository::default()),
                workspace_repo,
                mailer: Arc::new(mailer),
                github_oauth: Arc::new(MockGitHubOAuth::default()),
                google_oauth: Arc::new(MockGoogleOAuth::default()),
                oauth_accounts: OAuthAccountService::test_stub(),
                http_client: Arc::new(Client::new()),
                config: test_config(),
                worker_id: Arc::new("test-worker".to_string()),
                worker_lease_seconds: 30,
            });

        let request = Request::builder()
            .method("POST")
            .uri("/")
            .header("Content-Type", "application/json")
            .body(Body::from(serde_json::to_vec(&payload).unwrap()))
            .unwrap();

        app.oneshot(request).await.unwrap()
    }

    #[tokio::test]
    async fn test_email_already_taken() {
        let repo = MockRepo {
            email_taken: true,
            fail_create_user: false,
            fail_insert_token: false,
            cleaned_up: Arc::new(Mutex::new(false)),
        };

        let mailer = MockMailer::default();
        let res = run_signup(
            repo,
            Arc::new(NoopWorkspaceRepository::default()),
            mailer,
            test_payload(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn test_password_hash_fails() {
        let mut payload = test_payload();
        payload.password = "\0".to_string(); // bcrypt will fail

        let repo = MockRepo {
            email_taken: false,
            fail_create_user: false,
            fail_insert_token: false,
            cleaned_up: Arc::new(Mutex::new(false)),
        };

        let mailer = MockMailer::default();
        let res = run_signup(
            repo,
            Arc::new(NoopWorkspaceRepository::default()),
            mailer,
            payload,
        )
        .await;
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn test_create_user_fails() {
        let repo = MockRepo {
            email_taken: false,
            fail_create_user: true,
            fail_insert_token: false,
            cleaned_up: Arc::new(Mutex::new(false)),
        };

        let mailer = MockMailer::default();
        let res = run_signup(
            repo,
            Arc::new(NoopWorkspaceRepository::default()),
            mailer,
            test_payload(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn test_insert_token_fails() {
        let repo = MockRepo {
            email_taken: false,
            fail_create_user: false,
            fail_insert_token: true,
            cleaned_up: Arc::new(Mutex::new(false)),
        };

        let mailer = MockMailer::default();
        let res = run_signup(
            repo,
            Arc::new(NoopWorkspaceRepository::default()),
            mailer,
            test_payload(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn test_email_send_fails_and_triggers_cleanup() {
        let cleaned_up = Arc::new(Mutex::new(false));

        let repo = MockRepo {
            email_taken: false,
            fail_create_user: false,
            fail_insert_token: false,
            cleaned_up: Arc::clone(&cleaned_up),
        };

        let mut mailer = MockMailer::default();
        mailer.fail_send = true;

        let res = run_signup(
            repo,
            Arc::new(NoopWorkspaceRepository::default()),
            mailer,
            test_payload(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert!(*cleaned_up.lock().unwrap());
    }

    #[tokio::test]
    async fn test_successful_signup() {
        let repo = MockRepo {
            email_taken: false,
            fail_create_user: false,
            fail_insert_token: false,
            cleaned_up: Arc::new(Mutex::new(false)),
        };

        let mailer = MockMailer::default();
        let workspace_repo = Arc::new(RecordingWorkspaceRepo::default());
        let res = run_signup(
            repo,
            workspace_repo.clone() as Arc<dyn WorkspaceRepository>,
            mailer,
            test_payload(),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(
            json["message"],
            "User created. Check your email to verify your account."
        );

        let (created, add_calls, accepted, declined) = workspace_repo.record();
        assert_eq!(created.len(), 1);
        assert_eq!(created[0].name, "Test's Workspace");
        assert_eq!(add_calls.len(), 1);
        assert_eq!(add_calls[0].2, WorkspaceRole::Owner);
        assert!(accepted.is_empty());
        assert!(declined.is_empty());
    }

    #[tokio::test]
    async fn test_invite_join_attaches_membership() {
        let repo = MockRepo {
            email_taken: false,
            fail_create_user: false,
            fail_insert_token: false,
            cleaned_up: Arc::new(Mutex::new(false)),
        };
        let invite = invite_fixture(
            "join-token",
            "test@example.com",
            OffsetDateTime::now_utc() + Duration::hours(1),
        );
        let workspace_repo = Arc::new(RecordingWorkspaceRepo::with_invite(invite.clone()));
        let mailer = MockMailer::default();
        let mut payload = test_payload();
        payload.invite_token = Some(invite.token.clone());
        payload.invite_decision = Some(SignupInviteDecision::Join);

        let res = run_signup(
            repo,
            workspace_repo.clone() as Arc<dyn WorkspaceRepository>,
            mailer,
            payload,
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let (created, add_calls, accepted, declined) = workspace_repo.record();
        assert!(created.is_empty());
        assert_eq!(add_calls.len(), 1);
        assert_eq!(add_calls[0].0, invite.workspace_id);
        assert_eq!(add_calls[0].2, invite.role);
        assert_eq!(accepted, vec![invite.id]);
        assert!(declined.is_empty());
    }

    #[tokio::test]
    async fn test_invite_decline_marks_declined_and_creates_workspace() {
        let repo = MockRepo {
            email_taken: false,
            fail_create_user: false,
            fail_insert_token: false,
            cleaned_up: Arc::new(Mutex::new(false)),
        };
        let invite = invite_fixture(
            "decline-token",
            "test@example.com",
            OffsetDateTime::now_utc() + Duration::hours(1),
        );
        let workspace_repo = Arc::new(RecordingWorkspaceRepo::with_invite(invite.clone()));
        let mailer = MockMailer::default();
        let mut payload = test_payload();
        payload.invite_token = Some(invite.token.clone());
        payload.invite_decision = Some(SignupInviteDecision::Decline);

        let res = run_signup(
            repo,
            workspace_repo.clone() as Arc<dyn WorkspaceRepository>,
            mailer,
            payload,
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let (created, add_calls, accepted, declined) = workspace_repo.record();
        assert_eq!(created.len(), 1);
        assert_eq!(add_calls.len(), 1);
        assert_ne!(add_calls[0].0, invite.workspace_id);
        assert_eq!(add_calls[0].2, WorkspaceRole::Owner);
        assert!(accepted.is_empty());
        assert_eq!(declined, vec![invite.id]);
    }

    #[tokio::test]
    async fn test_invite_email_mismatch_rejected() {
        let repo = MockRepo {
            email_taken: false,
            fail_create_user: false,
            fail_insert_token: false,
            cleaned_up: Arc::new(Mutex::new(false)),
        };
        let invite = invite_fixture(
            "mismatch-token",
            "other@example.com",
            OffsetDateTime::now_utc() + Duration::hours(1),
        );
        let workspace_repo = Arc::new(RecordingWorkspaceRepo::with_invite(invite));
        let mailer = MockMailer::default();
        let mut payload = test_payload();
        payload.invite_token = Some("mismatch-token".into());
        payload.invite_decision = Some(SignupInviteDecision::Join);

        let res = run_signup(
            repo,
            workspace_repo.clone() as Arc<dyn WorkspaceRepository>,
            mailer,
            payload,
        )
        .await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let (created, add_calls, accepted, declined) = workspace_repo.record();
        assert!(created.is_empty());
        assert!(add_calls.is_empty());
        assert!(accepted.is_empty());
        assert!(declined.is_empty());
    }

    #[tokio::test]
    async fn test_expired_invite_rejected() {
        let repo = MockRepo {
            email_taken: false,
            fail_create_user: false,
            fail_insert_token: false,
            cleaned_up: Arc::new(Mutex::new(false)),
        };
        let invite = invite_fixture(
            "expired-token",
            "test@example.com",
            OffsetDateTime::now_utc() - Duration::hours(1),
        );
        let workspace_repo = Arc::new(RecordingWorkspaceRepo::with_invite(invite));
        let mailer = MockMailer::default();
        let mut payload = test_payload();
        payload.invite_token = Some("expired-token".into());
        payload.invite_decision = Some(SignupInviteDecision::Join);

        let res = run_signup(
            repo,
            workspace_repo.clone() as Arc<dyn WorkspaceRepository>,
            mailer,
            payload,
        )
        .await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let (created, add_calls, accepted, declined) = workspace_repo.record();
        assert!(created.is_empty());
        assert!(add_calls.is_empty());
        assert!(accepted.is_empty());
        assert!(declined.is_empty());
    }
}
