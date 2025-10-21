use async_trait::async_trait;
use serde_json::Value;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::db::workspace_connection_repository::{
    NewWorkspaceAuditEvent, NewWorkspaceConnection, WorkspaceConnectionListing,
    WorkspaceConnectionRepository,
};
use crate::models::oauth_token::{
    ConnectedOAuthProvider, WorkspaceAuditEvent, WorkspaceConnection,
};

pub struct PostgresWorkspaceConnectionRepository {
    pub pool: PgPool,
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
                provider,
                access_token,
                refresh_token,
                expires_at,
                account_email,
                updated_at
            )
            VALUES ($1, $2, $3::oauth_connection_provider, $4, $5, $6, $7, now())
            ON CONFLICT (workspace_id, provider)
            DO UPDATE SET
                created_by = EXCLUDED.created_by,
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                expires_at = EXCLUDED.expires_at,
                account_email = EXCLUDED.account_email,
                updated_at = now()
            RETURNING
                id,
                workspace_id,
                created_by,
                provider as "provider: _",
                access_token,
                refresh_token,
                expires_at,
                account_email,
                created_at,
                updated_at
            "#,
            new_connection.workspace_id,
            new_connection.created_by,
            new_connection.provider as ConnectedOAuthProvider,
            new_connection.access_token,
            new_connection.refresh_token,
            new_connection.expires_at,
            new_connection.account_email,
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
                workspace_id,
                created_by,
                provider as "provider: _",
                access_token,
                refresh_token,
                expires_at,
                account_email,
                created_at,
                updated_at
            FROM workspace_connections
            WHERE id = $1
            "#,
            connection_id,
        )
        .fetch_optional(&self.pool)
        .await
    }

    async fn find_by_workspace_and_provider(
        &self,
        workspace_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<Option<WorkspaceConnection>, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceConnection,
            r#"
            SELECT
                id,
                workspace_id,
                created_by,
                provider as "provider: _",
                access_token,
                refresh_token,
                expires_at,
                account_email,
                created_at,
                updated_at
            FROM workspace_connections
            WHERE workspace_id = $1 AND provider = $2::oauth_connection_provider
            "#,
            workspace_id,
            provider as ConnectedOAuthProvider,
        )
        .fetch_optional(&self.pool)
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
                wc.workspace_id,
                w.name AS workspace_name,
                wc.provider,
                wc.account_email,
                wc.expires_at,
                owner.first_name AS shared_by_first_name,
                owner.last_name AS shared_by_last_name,
                owner.email AS shared_by_email,
                wc.updated_at,
                (owner_token.id IS NULL) AS requires_reconnect
            FROM workspace_connections wc
            JOIN workspaces w ON w.id = wc.workspace_id
            LEFT JOIN users owner ON owner.id = wc.created_by
            LEFT JOIN user_oauth_tokens owner_token
                ON owner_token.user_id = wc.created_by
               AND owner_token.provider = wc.provider
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
                wc.workspace_id,
                w.name AS workspace_name,
                wc.provider,
                wc.account_email,
                wc.expires_at,
                owner.first_name AS shared_by_first_name,
                owner.last_name AS shared_by_last_name,
                owner.email AS shared_by_email,
                wc.updated_at,
                (owner_token.id IS NULL) AS requires_reconnect
            FROM workspace_connections wc
            JOIN workspace_members wm ON wm.workspace_id = wc.workspace_id
            JOIN workspaces w ON w.id = wc.workspace_id
            LEFT JOIN users owner ON owner.id = wc.created_by
            LEFT JOIN user_oauth_tokens owner_token
                ON owner_token.user_id = wc.created_by
               AND owner_token.provider = wc.provider
            WHERE wm.user_id = $1
              AND w.deleted_at IS NULL
            ORDER BY wc.id, wc.created_at ASC
            "#,
        )
        .bind(user_id)
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
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE workspace_connections
            SET
                access_token = $3,
                refresh_token = $4,
                expires_at = $5,
                account_email = $6,
                updated_at = now()
            WHERE created_by = $1
              AND provider = $2
            "#,
        )
        .bind(creator_id)
        .bind(provider)
        .bind(access_token)
        .bind(refresh_token)
        .bind(expires_at)
        .bind(account_email)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn update_tokens(
        &self,
        connection_id: Uuid,
        access_token: String,
        refresh_token: String,
        expires_at: OffsetDateTime,
    ) -> Result<WorkspaceConnection, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceConnection,
            r#"
            UPDATE workspace_connections
            SET
                access_token = $2,
                refresh_token = $3,
                expires_at = $4,
                updated_at = now()
            WHERE id = $1
            RETURNING
                id,
                workspace_id,
                created_by,
                provider as "provider: _",
                access_token,
                refresh_token,
                expires_at,
                account_email,
                created_at,
                updated_at
            "#,
            connection_id,
            access_token,
            refresh_token,
            expires_at,
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn delete_connection(&self, connection_id: Uuid) -> Result<(), sqlx::Error> {
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

    async fn mark_connections_stale_for_creator(
        &self,
        creator_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE workspace_connections
            SET
                expires_at = now() - INTERVAL '5 minutes',
                updated_at = now()
            WHERE created_by = $1
              AND provider = $2
            "#,
        )
        .bind(creator_id)
        .bind(provider)
        .execute(&self.pool)
        .await?;

        Ok(())
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
            event.metadata as Value,
        )
        .fetch_one(&self.pool)
        .await
    }
}
