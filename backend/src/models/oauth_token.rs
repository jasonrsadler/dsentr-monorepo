use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, Hash)]
#[sqlx(type_name = "oauth_connection_provider", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum ConnectedOAuthProvider {
    Google,
    Microsoft,
}

#[allow(dead_code)]
pub const WORKSPACE_AUDIT_EVENT_CONNECTION_PROMOTED: &str = "connection_promoted";

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct UserOAuthToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub provider: ConnectedOAuthProvider,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: OffsetDateTime,
    pub account_email: String,
    pub is_shared: bool,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct WorkspaceConnection {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub created_by: Uuid,
    pub provider: ConnectedOAuthProvider,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: OffsetDateTime,
    pub account_email: String,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct WorkspaceAuditEvent {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub actor_id: Uuid,
    pub event_type: String,
    pub metadata: serde_json::Value,
    pub created_at: OffsetDateTime,
}
