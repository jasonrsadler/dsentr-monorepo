use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct WorkflowRunEvent {
    pub id: Uuid,
    pub workflow_run_id: Uuid,
    pub workflow_id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub triggered_by: String,
    pub connection_type: Option<String>,
    pub connection_id: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub recorded_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct NewWorkflowRunEvent {
    pub workflow_run_id: Uuid,
    pub workflow_id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub triggered_by: String,
    pub connection_type: Option<String>,
    pub connection_id: Option<Uuid>,
    pub recorded_at: Option<OffsetDateTime>,
}
