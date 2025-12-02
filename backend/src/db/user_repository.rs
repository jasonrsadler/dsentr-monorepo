use async_trait::async_trait;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::models::{
    account_deletion::{AccountDeletionAuditInsert, AccountDeletionContext, AccountDeletionCounts},
    issue_report::NewIssueReport,
    signup::SignupPayload,
    user::{OauthProvider, PublicUser, User},
};

pub struct UserId {
    pub id: Uuid,
}

#[async_trait]
pub trait UserRepository: Send + Sync {
    async fn find_user_id_by_email(&self, email: &str) -> Result<Option<UserId>, sqlx::Error>;
    async fn insert_password_reset_token(
        &self,
        user_id: Uuid,
        token: &str,
        expires_at: OffsetDateTime,
    ) -> Result<(), sqlx::Error>;
    async fn find_user_by_email(&self, email: &str) -> Result<Option<User>, sqlx::Error>;
    #[allow(dead_code)]
    async fn create_user_with_oauth(
        &self,
        email: &str,
        first_name: &str,
        last_name: &str,
        provider: OauthProvider,
    ) -> Result<User, sqlx::Error>;
    async fn find_public_user_by_id(
        &self,
        user_id: Uuid,
    ) -> Result<Option<PublicUser>, sqlx::Error>;
    async fn verify_password_reset_token(&self, token: &str) -> Result<Option<Uuid>, sqlx::Error>;
    async fn update_user_password(
        &self,
        user_id: Uuid,
        password_hash: &str,
    ) -> Result<(), sqlx::Error>;
    async fn mark_password_reset_token_used(&self, token: &str) -> Result<(), sqlx::Error>;
    async fn is_email_taken(&self, email: &str) -> Result<bool, sqlx::Error>;
    async fn create_user(
        &self,
        payload: &SignupPayload,
        password_hash: &str,
        provider: OauthProvider,
    ) -> Result<Uuid, sqlx::Error>;
    async fn record_terms_acceptance(
        &self,
        user_id: Uuid,
        terms_version: &str,
        accepted_at: OffsetDateTime,
    ) -> Result<(), sqlx::Error>;
    async fn insert_verification_token(
        &self,
        user_id: Uuid,
        token: &str,
        expires_at: OffsetDateTime,
    ) -> Result<(), sqlx::Error>;
    async fn cleanup_user_and_token(&self, user_id: Uuid, token: &str) -> Result<(), sqlx::Error>;
    async fn mark_verification_token_used(
        &self,
        token: &str,
        now: OffsetDateTime,
    ) -> Result<Option<Uuid>, sqlx::Error>;
    async fn set_user_verified(&self, user_id: Uuid) -> Result<(), sqlx::Error>;
    async fn insert_early_access_email(&self, email: &str) -> Result<(), sqlx::Error>;
    async fn get_user_settings(&self, user_id: Uuid) -> Result<serde_json::Value, sqlx::Error>;
    async fn update_user_settings(
        &self,
        user_id: Uuid,
        settings: serde_json::Value,
    ) -> Result<(), sqlx::Error>;

    async fn update_user_plan(&self, user_id: Uuid, plan: &str) -> Result<(), sqlx::Error>;

    async fn mark_workspace_onboarded(
        &self,
        user_id: Uuid,
        onboarded_at: OffsetDateTime,
    ) -> Result<(), sqlx::Error>;

    // Stripe customer tracking
    async fn get_user_stripe_customer_id(
        &self,
        user_id: Uuid,
    ) -> Result<Option<String>, sqlx::Error>;

    async fn set_user_stripe_customer_id(
        &self,
        user_id: Uuid,
        stripe_customer_id: &str,
    ) -> Result<(), sqlx::Error>;

    // Billing helpers
    async fn find_user_id_by_stripe_customer_id(
        &self,
        customer_id: &str,
    ) -> Result<Option<Uuid>, sqlx::Error>;

    async fn clear_pending_checkout_with_error(
        &self,
        user_id: Uuid,
        message: &str,
    ) -> Result<(), sqlx::Error>;

    async fn create_issue_report(&self, report: NewIssueReport) -> Result<Uuid, sqlx::Error>;

    async fn upsert_account_deletion_token(
        &self,
        user_id: Uuid,
        token: &str,
        expires_at: OffsetDateTime,
    ) -> Result<(), sqlx::Error>;

    async fn get_account_deletion_context(
        &self,
        token: &str,
    ) -> Result<Option<AccountDeletionContext>, sqlx::Error>;

    async fn collect_account_deletion_counts(
        &self,
        user_id: Uuid,
    ) -> Result<AccountDeletionCounts, sqlx::Error>;

    async fn finalize_account_deletion(
        &self,
        token: &str,
        audit: AccountDeletionAuditInsert,
    ) -> Result<(), sqlx::Error>;

    async fn clear_stripe_customer_id(&self, user_id: Uuid) -> Result<(), sqlx::Error>;

    async fn delete_verification_tokens_for_user(&self, user_id: Uuid) -> Result<(), sqlx::Error>;
}
