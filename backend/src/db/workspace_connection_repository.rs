use async_trait::async_trait;
use serde_json::Value;
use uuid::Uuid;

use crate::models::oauth_token::{
    ConnectedOAuthProvider, WorkspaceAuditEvent, WorkspaceConnection,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaleWorkspaceConnection {
    pub connection_id: Uuid,
    pub workspace_id: Uuid,
}

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

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct WorkspaceConnectionListing {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub workspace_name: String,
    pub provider: ConnectedOAuthProvider,
    pub account_email: String,
    pub expires_at: time::OffsetDateTime,
    pub shared_by_first_name: Option<String>,
    pub shared_by_last_name: Option<String>,
    pub shared_by_email: Option<String>,
    pub updated_at: time::OffsetDateTime,
    pub requires_reconnect: bool,
}

#[async_trait]
#[allow(dead_code)]
pub trait WorkspaceConnectionRepository: Send + Sync {
    async fn insert_connection(
        &self,
        new_connection: NewWorkspaceConnection,
    ) -> Result<WorkspaceConnection, sqlx::Error>;

    async fn find_by_id(
        &self,
        connection_id: Uuid,
    ) -> Result<Option<WorkspaceConnection>, sqlx::Error>;

    async fn find_by_workspace_and_provider(
        &self,
        workspace_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<Option<WorkspaceConnection>, sqlx::Error>;

    async fn list_for_workspace(
        &self,
        workspace_id: Uuid,
    ) -> Result<Vec<WorkspaceConnectionListing>, sqlx::Error>;

    async fn list_for_user_memberships(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<WorkspaceConnectionListing>, sqlx::Error>;

    async fn update_tokens_for_creator(
        &self,
        creator_id: Uuid,
        provider: ConnectedOAuthProvider,
        access_token: String,
        refresh_token: String,
        expires_at: time::OffsetDateTime,
        account_email: String,
    ) -> Result<(), sqlx::Error>;

    async fn update_tokens(
        &self,
        connection_id: Uuid,
        access_token: String,
        refresh_token: String,
        expires_at: time::OffsetDateTime,
    ) -> Result<WorkspaceConnection, sqlx::Error>;

    async fn delete_connection(&self, connection_id: Uuid) -> Result<(), sqlx::Error>;

    async fn mark_connections_stale_for_creator(
        &self,
        creator_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<Vec<StaleWorkspaceConnection>, sqlx::Error>;

    async fn record_audit_event(
        &self,
        event: NewWorkspaceAuditEvent,
    ) -> Result<WorkspaceAuditEvent, sqlx::Error>;
}

#[derive(Default)]
#[allow(dead_code)]
pub struct NoopWorkspaceConnectionRepository;

#[async_trait]
impl WorkspaceConnectionRepository for NoopWorkspaceConnectionRepository {
    async fn insert_connection(
        &self,
        _new_connection: NewWorkspaceConnection,
    ) -> Result<WorkspaceConnection, sqlx::Error> {
        Err(sqlx::Error::RowNotFound)
    }

    async fn find_by_id(
        &self,
        _connection_id: Uuid,
    ) -> Result<Option<WorkspaceConnection>, sqlx::Error> {
        Ok(None)
    }

    async fn find_by_workspace_and_provider(
        &self,
        _workspace_id: Uuid,
        _provider: ConnectedOAuthProvider,
    ) -> Result<Option<WorkspaceConnection>, sqlx::Error> {
        Ok(None)
    }

    async fn list_for_workspace(
        &self,
        _workspace_id: Uuid,
    ) -> Result<Vec<WorkspaceConnectionListing>, sqlx::Error> {
        Ok(Vec::new())
    }

    async fn list_for_user_memberships(
        &self,
        _user_id: Uuid,
    ) -> Result<Vec<WorkspaceConnectionListing>, sqlx::Error> {
        Ok(Vec::new())
    }

    async fn update_tokens_for_creator(
        &self,
        _creator_id: Uuid,
        _provider: ConnectedOAuthProvider,
        _access_token: String,
        _refresh_token: String,
        _expires_at: time::OffsetDateTime,
        _account_email: String,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn update_tokens(
        &self,
        _connection_id: Uuid,
        _access_token: String,
        _refresh_token: String,
        _expires_at: time::OffsetDateTime,
    ) -> Result<WorkspaceConnection, sqlx::Error> {
        Err(sqlx::Error::RowNotFound)
    }

    async fn delete_connection(&self, _connection_id: Uuid) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn mark_connections_stale_for_creator(
        &self,
        _creator_id: Uuid,
        _provider: ConnectedOAuthProvider,
    ) -> Result<Vec<StaleWorkspaceConnection>, sqlx::Error> {
        Ok(Vec::new())
    }

    async fn record_audit_event(
        &self,
        _event: NewWorkspaceAuditEvent,
    ) -> Result<WorkspaceAuditEvent, sqlx::Error> {
        Err(sqlx::Error::RowNotFound)
    }
}
