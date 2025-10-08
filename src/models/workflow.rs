use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, FromRow, Serialize, Deserialize, Clone)]
pub struct Workflow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub data: serde_json::Value,
    pub concurrency_limit: i32,
    #[serde(skip_serializing)]
    pub webhook_salt: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateWorkflow {
    pub name: String,
    pub description: Option<String>,
    pub data: serde_json::Value,
}
