use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::models::user::User;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountDeletionToken {
    pub token: String,
    pub user_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub consumed_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct AccountDeletionContext {
    pub token: AccountDeletionToken,
    pub user: User,
}

#[derive(Debug, Clone, Default)]
pub struct AccountDeletionCounts {
    pub workflow_count: i64,
    pub owned_workspace_count: i64,
    pub member_workspace_count: i64,
    pub workflow_run_count: i64,
    pub workflow_log_count: i64,
    pub oauth_connection_count: i64,
    pub workspace_invitation_count: i64,
}

#[derive(Debug, Clone)]
pub struct AccountDeletionAuditInsert {
    pub user_id: Uuid,
    pub email: String,
    pub requested_at: OffsetDateTime,
    pub confirmed_at: OffsetDateTime,
    pub workflow_count: i64,
    pub owned_workspace_count: i64,
    pub member_workspace_count: i64,
    pub stripe_customer_id: Option<String>,
    pub oauth_provider: Option<String>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub metadata: Value,
}
