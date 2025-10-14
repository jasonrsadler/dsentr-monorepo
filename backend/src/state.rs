use crate::config::Config;
use crate::db::{user_repository::UserRepository, workflow_repository::WorkflowRepository};
use crate::services::oauth::{
    account_service::OAuthAccountService, github::service::GitHubOAuthService,
    google::service::GoogleOAuthService,
};
use crate::services::smtp_mailer::Mailer;
use reqwest::Client;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<dyn UserRepository>,
    pub workflow_repo: Arc<dyn WorkflowRepository>,
    pub mailer: Arc<dyn Mailer>,
    pub google_oauth: Arc<dyn GoogleOAuthService>,
    pub github_oauth: Arc<dyn GitHubOAuthService + Send + Sync>,
    pub oauth_accounts: Arc<OAuthAccountService>,
    pub http_client: Arc<Client>,
    pub config: Arc<Config>,
    pub worker_id: Arc<String>,
    pub worker_lease_seconds: i32,
}
