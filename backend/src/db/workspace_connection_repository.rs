use async_trait::async_trait;
use serde_json::Value;
use uuid::Uuid;

use crate::models::oauth_token::{
    ConnectedOAuthProvider, WorkspaceAuditEvent, WorkspaceConnection,
};

#[derive(Debug, Clone)]
pub struct NewWorkspaceConnection {
    pub workspace_id: Uuid,
    pub created_by: Uuid,
    pub provider: ConnectedOAuthProvider,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: time::OffsetDateTime,
    pub account_email: String,
}

#[derive(Debug, Clone)]
pub struct NewWorkspaceAuditEvent {
    pub workspace_id: Uuid,
    pub actor_id: Uuid,
    pub event_type: String,
    pub metadata: Value,
}

#[async_trait]
pub trait WorkspaceConnectionRepository: Send + Sync {
    async fn insert_connection(
        &self,
        new_connection: NewWorkspaceConnection,
    ) -> Result<WorkspaceConnection, sqlx::Error>;

    async fn find_by_workspace_and_provider(
        &self,
        workspace_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<Option<WorkspaceConnection>, sqlx::Error>;

    async fn delete_connection(&self, connection_id: Uuid) -> Result<(), sqlx::Error>;

    async fn record_audit_event(
        &self,
        event: NewWorkspaceAuditEvent,
    ) -> Result<WorkspaceAuditEvent, sqlx::Error>;
}

#[derive(Default)]
pub struct NoopWorkspaceConnectionRepository;

#[async_trait]
impl WorkspaceConnectionRepository for NoopWorkspaceConnectionRepository {
    async fn insert_connection(
        &self,
        _new_connection: NewWorkspaceConnection,
    ) -> Result<WorkspaceConnection, sqlx::Error> {
        Err(sqlx::Error::RowNotFound)
    }

    async fn find_by_workspace_and_provider(
        &self,
        _workspace_id: Uuid,
        _provider: ConnectedOAuthProvider,
    ) -> Result<Option<WorkspaceConnection>, sqlx::Error> {
        Ok(None)
    }

    async fn delete_connection(&self, _connection_id: Uuid) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn record_audit_event(
        &self,
        _event: NewWorkspaceAuditEvent,
    ) -> Result<WorkspaceAuditEvent, sqlx::Error> {
        Err(sqlx::Error::RowNotFound)
    }
}
