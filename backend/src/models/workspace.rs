use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Type};
use time::OffsetDateTime;
use uuid::Uuid;

pub const WORKSPACE_PLAN_SOLO: &str = "solo";
#[allow(dead_code)]
pub const WORKSPACE_PLAN_TEAM: &str = "workspace";

pub const INVITATION_STATUS_PENDING: &str = "pending";
pub const INVITATION_STATUS_ACCEPTED: &str = "accepted";
pub const INVITATION_STATUS_REVOKED: &str = "revoked";
pub const INVITATION_STATUS_DECLINED: &str = "declined";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[sqlx(type_name = "workspace_role")]
#[sqlx(rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceRole {
    Owner,
    Admin,
    User,
    Viewer,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Workspace {
    pub id: Uuid,
    pub name: String,
    pub created_by: Uuid,
    pub owner_id: Uuid,
    pub plan: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub deleted_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WorkspaceBillingCycle {
    pub workspace_id: Uuid,
    pub stripe_subscription_id: String,
    #[serde(with = "time::serde::rfc3339")]
    pub current_period_start: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub current_period_end: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub synced_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WorkspaceMember {
    pub workspace_id: Uuid,
    pub user_id: Uuid,
    pub role: WorkspaceRole,
    #[serde(with = "time::serde::rfc3339")]
    pub joined_at: OffsetDateTime,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceMembershipSummary {
    pub workspace: Workspace,
    pub role: WorkspaceRole,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WorkspaceInvitation {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub email: String,
    pub role: WorkspaceRole,
    pub token: String,
    pub status: String,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
    pub created_by: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub accepted_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub revoked_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub declined_at: Option<OffsetDateTime>,
}
