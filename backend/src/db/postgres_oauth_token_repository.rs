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
        // Enforce personal tokens only at this layer by ensuring workspace_id is NULL on write
        let query = r#"
            INSERT INTO user_oauth_tokens (
                user_id,
                workspace_id,
                provider,
                access_token,
                refresh_token,
                expires_at,
                account_email,
                metadata,
                updated_at
            )
            VALUES ($1, NULL, $2::oauth_connection_provider, $3, $4, $5, $6, $7, now())
            ON CONFLICT (user_id, provider)
            DO UPDATE SET
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                expires_at = EXCLUDED.expires_at,
                account_email = EXCLUDED.account_email,
                metadata = EXCLUDED.metadata,
                updated_at = now()
            RETURNING
                id,
                user_id,
                workspace_id,
                provider,
                access_token,
                refresh_token,
                expires_at,
                account_email,
                metadata,
                is_shared,
                created_at,
                updated_at
        "#;

        sqlx::query_as::<_, UserOAuthToken>(query)
            .bind(new_token.user_id)
            .bind(new_token.provider as ConnectedOAuthProvider)
            .bind(new_token.access_token)
            .bind(new_token.refresh_token)
            .bind(new_token.expires_at)
            .bind(new_token.account_email)
            .bind(new_token.metadata)
            .fetch_one(&self.pool)
            .await
    }

    async fn find_by_user_and_provider(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<Option<UserOAuthToken>, sqlx::Error> {
        let query = r#"
            SELECT
                id,
                user_id,
                workspace_id,
                provider,
                access_token,
                refresh_token,
                expires_at,
                account_email,
                metadata,
                is_shared,
                created_at,
                updated_at
            FROM user_oauth_tokens
            WHERE user_id = $1 AND provider = $2::oauth_connection_provider AND workspace_id IS NULL
        "#;
        sqlx::query_as::<_, UserOAuthToken>(query)
            .bind(user_id)
            .bind(provider as ConnectedOAuthProvider)
            .fetch_optional(&self.pool)
            .await
    }

    async fn delete_token(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<(), sqlx::Error> {
        let query = r#"
            DELETE FROM user_oauth_tokens
            WHERE user_id = $1 AND provider = $2::oauth_connection_provider AND workspace_id IS NULL
        "#;
        sqlx::query(query)
            .bind(user_id)
            .bind(provider as ConnectedOAuthProvider)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_tokens_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<UserOAuthToken>, sqlx::Error> {
        let query = r#"
            SELECT
                id,
                user_id,
                workspace_id,
                provider,
                access_token,
                refresh_token,
                expires_at,
                account_email,
                metadata,
                is_shared,
                created_at,
                updated_at
            FROM user_oauth_tokens
            WHERE user_id = $1 AND workspace_id IS NULL
            ORDER BY provider
        "#;
        sqlx::query_as::<_, UserOAuthToken>(query)
            .bind(user_id)
            .fetch_all(&self.pool)
            .await
    }

    async fn mark_shared(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
        is_shared: bool,
    ) -> Result<UserOAuthToken, sqlx::Error> {
        let query = r#"
            UPDATE user_oauth_tokens
            SET is_shared = $3, updated_at = now()
            WHERE user_id = $1 AND provider = $2::oauth_connection_provider AND workspace_id IS NULL
            RETURNING
                id,
                user_id,
                workspace_id,
                provider,
                access_token,
                refresh_token,
                expires_at,
                account_email,
                metadata,
                is_shared,
                created_at,
                updated_at
        "#;
        sqlx::query_as::<_, UserOAuthToken>(query)
            .bind(user_id)
            .bind(provider as ConnectedOAuthProvider)
            .bind(is_shared)
            .fetch_one(&self.pool)
            .await
    }
}
