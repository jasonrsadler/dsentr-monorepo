use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[allow(dead_code)]
pub struct IssueReport {
    pub id: Uuid,
    pub user_id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub user_email: String,
    pub user_name: String,
    pub user_plan: Option<String>,
    pub user_role: Option<String>,
    pub workspace_plan: Option<String>,
    pub workspace_role: Option<String>,
    pub description: String,
    pub metadata: Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub status: String,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewIssueReport {
    pub user_id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub user_email: String,
    pub user_name: String,
    pub user_plan: Option<String>,
    pub user_role: Option<String>,
    pub workspace_plan: Option<String>,
    pub workspace_role: Option<String>,
    pub description: String,
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct IssueReportMessage {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub sender_id: Option<Uuid>,
    pub sender_type: String,
    pub body: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}
