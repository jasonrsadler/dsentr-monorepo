use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WorkflowSchedule {
    pub id: Uuid,
    pub workflow_id: Uuid,
    pub user_id: Uuid,
    pub config: serde_json::Value,
    #[serde(with = "time::serde::rfc3339::option")]
    pub next_run_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_run_at: Option<OffsetDateTime>,
    pub enabled: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}
