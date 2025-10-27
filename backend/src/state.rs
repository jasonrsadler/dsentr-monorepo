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
use crate::services::stripe::StripeService;
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
    pub stripe: Arc<dyn StripeService>,
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
        // If claims already show a non-solo plan, still verify against current DB/Stripe to avoid stale auth
        let tier = from_claims;

        // Load current user record
        let user_opt = match self.db.find_public_user_by_id(user_id).await {
            Ok(u) => u,
            Err(err) => {
                error!(%user_id, ?err, "failed to refresh user plan tier from database");
                return tier;
            }
        };

        let Some(user) = user_opt else {
            return tier;
        };
        let db_tier = NormalizedPlanTier::from_option(user.plan.as_deref());

        // If DB says solo, trust it.
        if db_tier.is_solo() {
            return db_tier;
        }

        // Verify if a non-solo plan is still valid:
        // - skip when a checkout is pending (upgrade flow in progress)
        // - otherwise, ensure an active Stripe subscription exists; if not, revert to solo
        let mut has_pending_checkout = false;
        if let Ok(settings) = self.db.get_user_settings(user_id).await {
            if let Some(obj) = settings.as_object() {
                if let Some(b) = obj.get("billing").and_then(|v| v.as_object()) {
                    has_pending_checkout = b
                        .get("pending_checkout")
                        .map(|v| !v.is_null())
                        .unwrap_or(false);
                }
            }
        }

        if !has_pending_checkout {
            if let Ok(Some(customer_id)) = self.db.get_user_stripe_customer_id(user_id).await {
                match self
                    .stripe
                    .get_active_subscription_for_customer(&customer_id)
                    .await
                {
                    Ok(Some(_sub)) => {
                        // Active subscription present → keep workspace tier
                        return db_tier;
                    }
                    Ok(None) => {
                        // No active subscription → revert personal + owned workspaces to solo
                        if let Err(err) = self.db.update_user_plan(user_id, "solo").await {
                            error!(%user_id, ?err, "failed to revert user plan to solo during tier resolution");
                        } else if let Ok(memberships) =
                            self.workspace_repo.list_memberships_for_user(user_id).await
                        {
                            for m in memberships.into_iter().filter(|m| {
                                m.workspace.owner_id == user_id
                                    && m.workspace.plan.as_str() != "solo"
                            }) {
                                if let Err(err) = self
                                    .workspace_repo
                                    .update_workspace_plan(m.workspace.id, "solo")
                                    .await
                                {
                                    error!(workspace_id=%m.workspace.id, %user_id, ?err, "failed to downgrade workspace to solo during tier resolution");
                                }
                            }
                        }
                        return NormalizedPlanTier::Solo;
                    }
                    Err(err) => {
                        error!(%user_id, ?err, "failed to verify subscription while resolving plan tier");
                        // Fall through to DB tier since we couldn't verify
                        return db_tier;
                    }
                }
            }
        }

        db_tier
    }
}

// Re-export the StripeService trait (and mock for tests) for convenience in helpers/tests.
#[allow(unused_imports)]
pub use crate::services::stripe::{MockStripeService, StripeService as StripeServiceTrait};

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
                stripe_customer_id: None,
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
                slack: crate::config::OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                token_encryption_key: vec![0u8; 32],
            },
            stripe: crate::config::StripeSettings {
                client_id: "stub".into(),
                secret_key: "stub".into(),
                webhook_secret: "stub".into(),
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
            stripe: Arc::new(crate::services::stripe::MockStripeService::new()),
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
