use async_trait::async_trait;
use sqlx::{PgPool, Row};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::db::workspace_connection_repository::{
    NewWorkspaceAuditEvent, NewWorkspaceConnection, StaleWorkspaceConnection,
    WorkspaceConnectionListing, WorkspaceConnectionRepository,
};
use crate::models::oauth_token::{
    ConnectedOAuthProvider, WorkspaceAuditEvent, WorkspaceConnection,
};

pub struct PostgresWorkspaceConnectionRepository {
    pub pool: PgPool,
}

struct WorkspaceConnectionIdentity {
    provider: ConnectedOAuthProvider,
    owner_user_id: Uuid,
    user_oauth_token_id: Option<Uuid>,
}

#[async_trait]
impl WorkspaceConnectionRepository for PostgresWorkspaceConnectionRepository {
    async fn insert_connection(
        &self,
        new_connection: NewWorkspaceConnection,
    ) -> Result<WorkspaceConnection, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceConnection,
            r#"
            INSERT INTO workspace_connections (
                workspace_id,
                created_by,
                owner_user_id,
                user_oauth_token_id,
                connection_id,
                provider,
                access_token,
                refresh_token,
                expires_at,
                account_email,
                updated_at,
                bot_user_id,
                slack_team_id,
                incoming_webhook_url,
                metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6::oauth_connection_provider, $7, $8, $9, $10, now(), $11, $12, $13, $14)
            RETURNING
                id,
                connection_id as "connection_id?",
                workspace_id,
                created_by,
                owner_user_id,
                user_oauth_token_id as "user_oauth_token_id?",
                provider as "provider: _",
                access_token,
                refresh_token,
                expires_at,
                account_email,
                created_at,
                updated_at,
                bot_user_id,
                slack_team_id,
                incoming_webhook_url,
                metadata
            "#,
            new_connection.workspace_id,
            new_connection.created_by,
            new_connection.owner_user_id,
            new_connection.user_oauth_token_id,
            new_connection.connection_id,
            new_connection.provider as ConnectedOAuthProvider,
            new_connection.access_token,
            new_connection.refresh_token,
            new_connection.expires_at,
            new_connection.account_email,
            new_connection.bot_user_id,
            new_connection.slack_team_id,
            new_connection.incoming_webhook_url,
            new_connection.metadata,
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn find_by_id(
        &self,
        connection_id: Uuid,
    ) -> Result<Option<WorkspaceConnection>, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceConnection,
            r#"
            SELECT
                id,
                connection_id as "connection_id?",
                workspace_id,
                created_by,
                owner_user_id,
                user_oauth_token_id as "user_oauth_token_id?",
                provider as "provider: _",
                access_token,
                refresh_token,
                expires_at,
                account_email,
                created_at,
                updated_at,
                bot_user_id,
                slack_team_id,
                incoming_webhook_url,
                metadata
            FROM workspace_connections
            WHERE id = $1
            "#,
            connection_id,
        )
        .fetch_optional(&self.pool)
        .await
    }

    async fn get_by_id(&self, connection_id: Uuid) -> Result<WorkspaceConnection, sqlx::Error> {
        self.find_by_id(connection_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    async fn list_for_workspace_provider(
        &self,
        workspace_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<Vec<WorkspaceConnection>, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceConnection,
            r#"
            SELECT
                id,
                connection_id as "connection_id?",
                workspace_id,
                created_by,
                owner_user_id,
                user_oauth_token_id as "user_oauth_token_id?",
                provider as "provider: _",
                access_token,
                refresh_token,
                expires_at,
                account_email,
                created_at,
                updated_at,
                bot_user_id,
                slack_team_id,
                incoming_webhook_url,
                metadata
            FROM workspace_connections
            WHERE workspace_id = $1
              AND provider = $2::oauth_connection_provider
            ORDER BY created_at ASC
            "#,
            workspace_id,
            provider as ConnectedOAuthProvider,
        )
        .fetch_all(&self.pool)
        .await
    }

    async fn list_by_workspace_and_provider(
        &self,
        workspace_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<Vec<WorkspaceConnection>, sqlx::Error> {
        self.list_for_workspace_provider(workspace_id, provider)
            .await
    }

    async fn find_by_source_token(
        &self,
        user_oauth_token_id: Uuid,
    ) -> Result<Vec<WorkspaceConnection>, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceConnection,
            r#"
            SELECT
                id,
                connection_id as "connection_id?",
                workspace_id,
                created_by,
                owner_user_id,
                user_oauth_token_id as "user_oauth_token_id?",
                provider as "provider: _",
                access_token,
                refresh_token,
                expires_at,
                account_email,
                created_at,
                updated_at,
                bot_user_id,
                slack_team_id,
                incoming_webhook_url,
                metadata
            FROM workspace_connections
            WHERE user_oauth_token_id = $1
            ORDER BY created_at ASC
            "#,
            user_oauth_token_id,
        )
        .fetch_all(&self.pool)
        .await
    }

    async fn list_for_workspace(
        &self,
        workspace_id: Uuid,
    ) -> Result<Vec<WorkspaceConnectionListing>, sqlx::Error> {
        sqlx::query_as::<_, WorkspaceConnectionListing>(
            r#"
            SELECT
                wc.id,
                wc.connection_id,
                wc.workspace_id,
                wc.owner_user_id,
                w.name AS workspace_name,
                wc.provider,
                wc.account_email,
                wc.expires_at,
                owner.first_name AS shared_by_first_name,
                owner.last_name AS shared_by_last_name,
                owner.email AS shared_by_email,
                wc.updated_at,
                (owner_token.id IS NULL) AS requires_reconnect,
                (wc.incoming_webhook_url IS NOT NULL) AS has_incoming_webhook
            FROM workspace_connections wc
            JOIN workspaces w ON w.id = wc.workspace_id
            LEFT JOIN users owner ON owner.id = wc.owner_user_id
            LEFT JOIN user_oauth_tokens owner_token
                ON owner_token.id = wc.user_oauth_token_id
            WHERE wc.workspace_id = $1
            ORDER BY wc.created_at ASC
            "#,
        )
        .bind(workspace_id)
        .fetch_all(&self.pool)
        .await
    }

    async fn list_for_user_memberships(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<WorkspaceConnectionListing>, sqlx::Error> {
        sqlx::query_as::<_, WorkspaceConnectionListing>(
            r#"
            SELECT DISTINCT ON (wc.id)
                wc.id,
                wc.connection_id,
                wc.workspace_id,
                wc.owner_user_id,
                w.name AS workspace_name,
                wc.provider,
                wc.account_email,
                wc.expires_at,
                owner.first_name AS shared_by_first_name,
                owner.last_name AS shared_by_last_name,
                owner.email AS shared_by_email,
                wc.updated_at,
                (owner_token.id IS NULL) AS requires_reconnect,
                (wc.incoming_webhook_url IS NOT NULL) AS has_incoming_webhook
            FROM workspace_connections wc
            JOIN workspace_members wm ON wm.workspace_id = wc.workspace_id
            JOIN workspaces w ON w.id = wc.workspace_id
            LEFT JOIN users owner ON owner.id = wc.owner_user_id
            LEFT JOIN user_oauth_tokens owner_token
                ON owner_token.id = wc.user_oauth_token_id
            WHERE wm.user_id = $1
              AND w.deleted_at IS NULL
            ORDER BY wc.id, wc.created_at ASC
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
    }

    async fn list_by_workspace_creator(
        &self,
        workspace_id: Uuid,
        creator_id: Uuid,
    ) -> Result<Vec<WorkspaceConnection>, sqlx::Error> {
        sqlx::query_as::<_, WorkspaceConnection>(
            r#"
            SELECT
                id,
                connection_id,
                workspace_id,
                created_by,
                owner_user_id,
                user_oauth_token_id,
                provider,
                access_token,
                refresh_token,
                expires_at,
                account_email,
                created_at,
                updated_at,
                bot_user_id,
                slack_team_id,
                incoming_webhook_url,
                metadata
            FROM workspace_connections
            WHERE workspace_id = $1
              AND owner_user_id = $2
            "#,
        )
        .bind(workspace_id)
        .bind(creator_id)
        .fetch_all(&self.pool)
        .await
    }

    async fn update_tokens_for_creator(
        &self,
        creator_id: Uuid,
        provider: ConnectedOAuthProvider,
        access_token: String,
        refresh_token: String,
        expires_at: OffsetDateTime,
        account_email: String,
        bot_user_id: Option<String>,
        slack_team_id: Option<String>,
        incoming_webhook_url: Option<String>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE workspace_connections
            SET
                access_token = $3,
                refresh_token = $4,
                expires_at = $5,
                account_email = $6,
                updated_at = now(),
                bot_user_id = COALESCE($7, bot_user_id),
                slack_team_id = COALESCE($8, slack_team_id),
                incoming_webhook_url = COALESCE($9, incoming_webhook_url)
            WHERE owner_user_id = $1
              AND provider = $2::oauth_connection_provider
            "#,
        )
        .bind(creator_id)
        .bind(provider)
        .bind(access_token)
        .bind(refresh_token)
        .bind(expires_at)
        .bind(account_email)
        .bind(bot_user_id)
        .bind(slack_team_id)
        .bind(incoming_webhook_url)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn update_tokens_for_connection(
        &self,
        connection_id: Uuid,
        access_token: String,
        refresh_token: String,
        expires_at: OffsetDateTime,
        account_email: String,
        bot_user_id: Option<String>,
        slack_team_id: Option<String>,
        incoming_webhook_url: Option<String>,
    ) -> Result<WorkspaceConnection, sqlx::Error> {
        let identity = sqlx::query_as!(
            WorkspaceConnectionIdentity,
            r#"
            SELECT
                provider as "provider: _",
                owner_user_id,
                user_oauth_token_id
            FROM workspace_connections
            WHERE id = $1
            "#,
            connection_id,
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;

        if identity.user_oauth_token_id.is_none() {
            return Err(sqlx::Error::RowNotFound);
        }

        sqlx::query_as!(
            WorkspaceConnection,
            r#"
            UPDATE workspace_connections
            SET
                access_token = $2,
                refresh_token = $3,
                expires_at = $4,
                account_email = $5,
                updated_at = now(),
                bot_user_id = COALESCE($6, bot_user_id),
                slack_team_id = COALESCE($7, slack_team_id),
                incoming_webhook_url = COALESCE($8, incoming_webhook_url)
            WHERE id = $1
              AND provider = $9::oauth_connection_provider
              AND owner_user_id = $10
              AND user_oauth_token_id IS NOT DISTINCT FROM $11
            RETURNING
                id,
                connection_id as "connection_id?",
                workspace_id,
                created_by,
                owner_user_id,
                user_oauth_token_id as "user_oauth_token_id?",
                provider as "provider: _",
                access_token,
                refresh_token,
                expires_at,
                account_email,
                created_at,
                updated_at,
                bot_user_id,
                slack_team_id,
                incoming_webhook_url,
                metadata
            "#,
            connection_id,
            access_token,
            refresh_token,
            expires_at,
            account_email,
            bot_user_id,
            slack_team_id,
            incoming_webhook_url,
            identity.provider as ConnectedOAuthProvider,
            identity.owner_user_id,
            identity.user_oauth_token_id,
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn update_tokens(
        &self,
        connection_id: Uuid,
        access_token: String,
        refresh_token: String,
        expires_at: OffsetDateTime,
        bot_user_id: Option<String>,
        slack_team_id: Option<String>,
        incoming_webhook_url: Option<String>,
    ) -> Result<WorkspaceConnection, sqlx::Error> {
        let identity = sqlx::query_as!(
            WorkspaceConnectionIdentity,
            r#"
            SELECT
                provider as "provider: _",
                owner_user_id,
                user_oauth_token_id
            FROM workspace_connections
            WHERE id = $1
            "#,
            connection_id,
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;

        if identity.user_oauth_token_id.is_none() {
            return Err(sqlx::Error::RowNotFound);
        }

        sqlx::query_as!(
            WorkspaceConnection,
            r#"
            UPDATE workspace_connections
            SET
                access_token = $2,
                refresh_token = $3,
                expires_at = $4,
                updated_at = now(),
                bot_user_id = COALESCE($5, bot_user_id),
                slack_team_id = COALESCE($6, slack_team_id),
                incoming_webhook_url = COALESCE($7, incoming_webhook_url)
            WHERE id = $1
              AND provider = $8::oauth_connection_provider
              AND owner_user_id = $9
              AND user_oauth_token_id IS NOT DISTINCT FROM $10
            RETURNING
                id,
                connection_id as "connection_id?",
                workspace_id,
                created_by,
                owner_user_id,
                user_oauth_token_id as "user_oauth_token_id?",
                provider as "provider: _",
                access_token,
                refresh_token,
                expires_at,
                account_email,
                created_at,
                updated_at,
                bot_user_id,
                slack_team_id,
                incoming_webhook_url,
                metadata
            "#,
            connection_id,
            access_token,
            refresh_token,
            expires_at,
            bot_user_id,
            slack_team_id,
            incoming_webhook_url,
            identity.provider as ConnectedOAuthProvider,
            identity.owner_user_id,
            identity.user_oauth_token_id,
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn delete_connection(&self, connection_id: Uuid) -> Result<(), sqlx::Error> {
        self.delete_by_id(connection_id).await
    }

    async fn delete_by_id(&self, connection_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            DELETE FROM workspace_connections
            WHERE id = $1
            "#,
            connection_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn delete_by_owner_and_provider(
        &self,
        workspace_id: Uuid,
        owner_user_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            DELETE FROM workspace_connections
            WHERE workspace_id = $1
              AND owner_user_id = $2
              AND provider = $3::oauth_connection_provider
            "#,
            workspace_id,
            owner_user_id,
            provider as ConnectedOAuthProvider,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn delete_by_owner_and_provider_and_id(
        &self,
        workspace_id: Uuid,
        owner_user_id: Uuid,
        provider: ConnectedOAuthProvider,
        connection_id: Uuid,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            DELETE FROM workspace_connections
            WHERE workspace_id = $1
              AND owner_user_id = $2
              AND provider = $3::oauth_connection_provider
              AND id = $4
            "#,
            workspace_id,
            owner_user_id,
            provider as ConnectedOAuthProvider,
            connection_id,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn has_connections_for_owner_provider(
        &self,
        owner_user_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<bool, sqlx::Error> {
        let exists = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM workspace_connections
                WHERE owner_user_id = $1
                  AND provider = $2::oauth_connection_provider
            )
            "#,
            owner_user_id,
            provider as ConnectedOAuthProvider,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(exists.unwrap_or(false))
    }

    async fn mark_connections_stale_for_creator(
        &self,
        creator_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<Vec<StaleWorkspaceConnection>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            UPDATE workspace_connections
            SET
                expires_at = now() - INTERVAL '5 minutes',
                updated_at = now()
            WHERE owner_user_id = $1
              AND provider = $2
            RETURNING id, workspace_id
            "#,
        )
        .bind(creator_id)
        .bind(provider)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(StaleWorkspaceConnection {
                    connection_id: row.try_get("id")?,
                    workspace_id: row.try_get("workspace_id")?,
                })
            })
            .collect()
    }

    async fn record_audit_event(
        &self,
        event: NewWorkspaceAuditEvent,
    ) -> Result<WorkspaceAuditEvent, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceAuditEvent,
            r#"
            INSERT INTO workspace_audit_events (
                workspace_id,
                actor_id,
                event_type,
                metadata
            )
            VALUES ($1, $2, $3, $4)
            RETURNING
                id,
                workspace_id,
                actor_id,
                event_type,
                metadata,
                created_at
            "#,
            event.workspace_id,
            event.actor_id,
            event.event_type,
            event.metadata as serde_json::Value,
        )
        .fetch_one(&self.pool)
        .await
    }
}
