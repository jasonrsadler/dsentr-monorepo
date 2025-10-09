use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, FromRow, Serialize, Deserialize, Clone)]
pub struct WorkflowLog {
    pub id: Uuid,
    pub user_id: Uuid,
    pub workflow_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub diffs: serde_json::Value,
}
