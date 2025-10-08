use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, FromRow, Serialize, Deserialize, Clone)]
pub struct WorkflowDeadLetter {
    pub id: Uuid,
    pub user_id: Uuid,
    pub workflow_id: Uuid,
    pub run_id: Uuid,
    pub error: String,
    pub snapshot: serde_json::Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

