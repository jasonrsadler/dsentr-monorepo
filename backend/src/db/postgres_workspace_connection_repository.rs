use async_trait::async_trait;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::workspace_connection_repository::{
    NewWorkspaceAuditEvent, NewWorkspaceConnection, WorkspaceConnectionRepository,
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
