use async_trait::async_trait;
use serde_json::Value;
use uuid::Uuid;

use crate::models::workflow::Workflow;

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

    async fn delete_workflow(&self, user_id: Uuid, workflow_id: Uuid) -> Result<bool, sqlx::Error>;
}
