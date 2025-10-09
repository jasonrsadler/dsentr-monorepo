use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, FromRow, Serialize, Deserialize, Clone)]
pub struct EgressBlockEvent {
    pub id: Uuid,
    pub user_id: Uuid,
    pub workflow_id: Uuid,
    pub run_id: Uuid,
    pub node_id: String,
    pub url: String,
    pub host: String,
    pub rule: String,
    pub message: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

