use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::oauth_token_repository::{NewUserOAuthToken, UserOAuthTokenRepository};
use crate::models::oauth_token::{ConnectedOAuthProvider, UserOAuthToken};

pub struct PostgresUserOAuthTokenRepository {
    pub pool: PgPool,
}

#[async_trait]
impl UserOAuthTokenRepository for PostgresUserOAuthTokenRepository {
    async fn upsert_token(
        &self,
        new_token: NewUserOAuthToken,
    ) -> Result<UserOAuthToken, sqlx::Error> {
        sqlx::query_as!(
            UserOAuthToken,
            r#"
            INSERT INTO user_oauth_tokens (
                user_id,
                provider,
                access_token,
                refresh_token,
                expires_at,
                account_email,
                updated_at
            )
            VALUES ($1, $2::oauth_connection_provider, $3, $4, $5, $6, now())
            ON CONFLICT (user_id, provider)
            DO UPDATE SET
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                expires_at = EXCLUDED.expires_at,
                account_email = EXCLUDED.account_email,
                updated_at = now()
            RETURNING
                id,
                user_id,
                provider as "provider: _",
                access_token,
                refresh_token,
                expires_at,
                account_email,
                is_shared,
                created_at,
                updated_at
            "#,
            new_token.user_id,
            new_token.provider as ConnectedOAuthProvider,
            new_token.access_token,
            new_token.refresh_token,
            new_token.expires_at,
            new_token.account_email
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn find_by_user_and_provider(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<Option<UserOAuthToken>, sqlx::Error> {
        sqlx::query_as!(
            UserOAuthToken,
            r#"
            SELECT
                id,
                user_id,
                provider as "provider: _",
                access_token,
                refresh_token,
                expires_at,
                account_email,
                is_shared,
                created_at,
                updated_at
            FROM user_oauth_tokens
            WHERE user_id = $1 AND provider = $2::oauth_connection_provider
            "#,
            user_id,
            provider as ConnectedOAuthProvider
        )
        .fetch_optional(&self.pool)
        .await
    }

    async fn delete_token(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            DELETE FROM user_oauth_tokens
            WHERE user_id = $1 AND provider = $2::oauth_connection_provider
            "#,
            user_id,
            provider as ConnectedOAuthProvider
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn list_tokens_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<UserOAuthToken>, sqlx::Error> {
        sqlx::query_as!(
            UserOAuthToken,
            r#"
            SELECT
                id,
                user_id,
                provider as "provider: _",
                access_token,
                refresh_token,
                expires_at,
                account_email,
                is_shared,
                created_at,
                updated_at
            FROM user_oauth_tokens
            WHERE user_id = $1
            ORDER BY provider
            "#,
            user_id
        )
        .fetch_all(&self.pool)
        .await
    }

    async fn mark_shared(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
        is_shared: bool,
    ) -> Result<UserOAuthToken, sqlx::Error> {
        sqlx::query_as!(
            UserOAuthToken,
            r#"
            UPDATE user_oauth_tokens
            SET is_shared = $3, updated_at = now()
            WHERE user_id = $1 AND provider = $2::oauth_connection_provider
            RETURNING
                id,
                user_id,
                provider as "provider: _",
                access_token,
                refresh_token,
                expires_at,
                account_email,
                is_shared,
                created_at,
                updated_at
            "#,
            user_id,
            provider as ConnectedOAuthProvider,
            is_shared,
        )
        .fetch_one(&self.pool)
        .await
    }
}
