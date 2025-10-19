use async_trait::async_trait;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::models::oauth_token::{ConnectedOAuthProvider, UserOAuthToken};

#[derive(Debug, Clone)]
pub struct NewUserOAuthToken {
    pub user_id: Uuid,
    pub provider: ConnectedOAuthProvider,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: OffsetDateTime,
    pub account_email: String,
}

#[async_trait]
pub trait UserOAuthTokenRepository: Send + Sync {
    async fn upsert_token(
        &self,
        new_token: NewUserOAuthToken,
    ) -> Result<UserOAuthToken, sqlx::Error>;

    async fn find_by_user_and_provider(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<Option<UserOAuthToken>, sqlx::Error>;

    async fn delete_token(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<(), sqlx::Error>;

    async fn list_tokens_for_user(&self, user_id: Uuid)
        -> Result<Vec<UserOAuthToken>, sqlx::Error>;

    async fn mark_shared(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
        is_shared: bool,
    ) -> Result<UserOAuthToken, sqlx::Error>;
}
