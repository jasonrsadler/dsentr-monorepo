use crate::config::Config;
use crate::db::{
    user_repository::UserRepository, workflow_repository::WorkflowRepository,
    workspace_connection_repository::WorkspaceConnectionRepository,
    workspace_repository::WorkspaceRepository,
};
use crate::services::oauth::{
    account_service::OAuthAccountService, github::service::GitHubOAuthService,
    google::service::GoogleOAuthService, workspace_service::WorkspaceOAuthService,
};
use crate::services::smtp_mailer::Mailer;
use crate::utils::plan_limits::NormalizedPlanTier;
use reqwest::Client;
use std::sync::Arc;
use tracing::error;
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<dyn UserRepository>,
    pub workflow_repo: Arc<dyn WorkflowRepository>,
    pub workspace_repo: Arc<dyn WorkspaceRepository>,
    pub workspace_connection_repo: Arc<dyn WorkspaceConnectionRepository>,
    pub mailer: Arc<dyn Mailer>,
    pub google_oauth: Arc<dyn GoogleOAuthService>,
    pub github_oauth: Arc<dyn GitHubOAuthService + Send + Sync>,
    pub oauth_accounts: Arc<OAuthAccountService>,
    pub workspace_oauth: Arc<WorkspaceOAuthService>,
    pub http_client: Arc<Client>,
    pub config: Arc<Config>,
    pub worker_id: Arc<String>,
    pub worker_lease_seconds: i32,
}

impl AppState {
    pub async fn resolve_plan_tier(
        &self,
        user_id: Uuid,
        claims_plan: Option<&str>,
    ) -> NormalizedPlanTier {
        let from_claims = NormalizedPlanTier::from_option(claims_plan);
        if !from_claims.is_solo() {
            return from_claims;
        }

        match self.db.find_public_user_by_id(user_id).await {
            Ok(Some(user)) => NormalizedPlanTier::from_option(user.plan.as_deref()),
            Ok(None) => from_claims,
            Err(err) => {
                error!(%user_id, ?err, "failed to refresh user plan tier from database");
                from_claims
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::mock_db::{MockDb, NoopWorkflowRepository, NoopWorkspaceRepository};
    use crate::db::workspace_connection_repository::NoopWorkspaceConnectionRepository;
    use crate::models::user::{OauthProvider, User, UserRole};
    use crate::services::{
        oauth::{
            account_service::OAuthAccountService, github::mock_github_oauth::MockGitHubOAuth,
            google::mock_google_oauth::MockGoogleOAuth,
        },
        smtp_mailer::{MailError, Mailer, SmtpConfig},
    };
    use async_trait::async_trait;
    use reqwest::Client;
    use std::sync::Arc;
    use time::OffsetDateTime;

    #[derive(Default)]
    struct NoopMailer;

    #[async_trait]
    impl Mailer for NoopMailer {
        async fn send_verification_email(&self, _: &str, _: &str) -> Result<(), MailError> {
            Ok(())
        }

        async fn send_reset_email(&self, _: &str, _: &str) -> Result<(), MailError> {
            Ok(())
        }

        async fn send_email_generic(&self, _: &str, _: &str, _: &str) -> Result<(), MailError> {
            Ok(())
        }

        async fn send_email_with_config(
            &self,
            _: &SmtpConfig,
            _: &[String],
            _: &str,
            _: &str,
        ) -> Result<(), MailError> {
            Ok(())
        }

        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    fn build_state_with_user(plan: Option<&str>) -> (AppState, Uuid) {
        let user_id = Uuid::new_v4();
        let db = MockDb {
            find_user_result: Some(User {
                id: user_id,
                email: "user@example.com".into(),
                password_hash: String::new(),
                first_name: "Plan".into(),
                last_name: "Tester".into(),
                role: Some(UserRole::User),
                plan: plan.map(|p| p.to_string()),
                company_name: None,
                oauth_provider: Some(OauthProvider::Email),
                onboarded_at: Some(OffsetDateTime::now_utc()),
                created_at: OffsetDateTime::now_utc(),
            }),
            ..Default::default()
        };

        let config = Arc::new(Config {
            database_url: String::new(),
            frontend_origin: "http://localhost".into(),
            oauth: crate::config::OAuthSettings {
                google: crate::config::OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                microsoft: crate::config::OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                token_encryption_key: vec![0u8; 32],
            },
        });

        let state = AppState {
            db: Arc::new(db),
            workflow_repo: Arc::new(NoopWorkflowRepository),
            workspace_repo: Arc::new(NoopWorkspaceRepository),
            workspace_connection_repo: Arc::new(NoopWorkspaceConnectionRepository),
            mailer: Arc::new(NoopMailer),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts: OAuthAccountService::test_stub(),
            workspace_oauth: WorkspaceOAuthService::test_stub(),
            http_client: Arc::new(Client::new()),
            config,
            worker_id: Arc::new("test-worker".into()),
            worker_lease_seconds: 30,
        };

        (state, user_id)
    }

    #[tokio::test]
    async fn resolve_plan_tier_uses_database_plan_for_upgraded_user() {
        let (state, user_id) = build_state_with_user(Some("workspace"));
        let tier = state.resolve_plan_tier(user_id, Some("solo")).await;
        assert_eq!(tier, NormalizedPlanTier::Workspace);
    }

    #[tokio::test]
    async fn resolve_plan_tier_falls_back_to_claims_when_user_missing() {
        let (state, user_id) = build_state_with_user(None);
        let tier = state.resolve_plan_tier(user_id, Some("solo")).await;
        assert_eq!(tier, NormalizedPlanTier::Solo);
    }
}
