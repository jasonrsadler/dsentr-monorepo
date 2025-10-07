use async_trait::async_trait;
use serde_json::Value;
use uuid::Uuid;

use crate::models::workflow::Workflow;
use crate::models::workflow_log::WorkflowLog;

#[async_trait]
pub trait WorkflowRepository: Send + Sync {
    async fn create_workflow(
        &self,
        user_id: Uuid,
        name: &str,
        description: Option<&str>,
        data: Value,
    ) -> Result<Workflow, sqlx::Error>;

    async fn list_workflows_by_user(&self, user_id: Uuid) -> Result<Vec<Workflow>, sqlx::Error>;

    async fn find_workflow_by_id(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
    ) -> Result<Option<Workflow>, sqlx::Error>;

    async fn update_workflow(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        name: &str,
        description: Option<&str>,
        data: Value,
    ) -> Result<Option<Workflow>, sqlx::Error>;

    async fn delete_workflow(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
    ) -> Result<bool, sqlx::Error>;

    // Logging methods
    async fn insert_workflow_log(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        diffs: serde_json::Value,
    ) -> Result<(), sqlx::Error>;

    async fn list_workflow_logs(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<WorkflowLog>, sqlx::Error>;

    async fn delete_workflow_log(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        log_id: Uuid,
    ) -> Result<bool, sqlx::Error>;

    async fn clear_workflow_logs(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
    ) -> Result<u64, sqlx::Error>;
}
