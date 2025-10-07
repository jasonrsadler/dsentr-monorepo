use crate::{db::workflow_repository::WorkflowRepository, models::workflow::Workflow};
use async_trait::async_trait;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

pub struct PostgresWorkflowRepository {
    pub pool: PgPool,
}

#[async_trait]
impl WorkflowRepository for PostgresWorkflowRepository {
    async fn create_workflow(
        &self,
        user_id: Uuid,
        name: &str,
        description: Option<&str>,
        data: Value,
    ) -> Result<Workflow, sqlx::Error> {
        let result = sqlx::query_as!(
            Workflow,
            r#"
            INSERT INTO workflows (user_id, name, description, data, created_at, updated_at)
            VALUES ($1, $2, $3, $4, now(), now())
            RETURNING id, user_id, name, description, data, created_at as "created_at!", updated_at as "updated_at!"
            "#,
            user_id,
            name,
            description,
            data
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(result)
    }

    async fn list_workflows_by_user(&self, user_id: Uuid) -> Result<Vec<Workflow>, sqlx::Error> {
        let results = sqlx::query_as!(
            Workflow,
            r#"
            SELECT id, user_id, name, description, data, created_at as "created_at!", updated_at as "updated_at!"
            FROM workflows
            WHERE user_id = $1
            ORDER BY updated_at DESC
            "#,
            user_id
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(results)
    }

    async fn find_workflow_by_id(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
    ) -> Result<Option<Workflow>, sqlx::Error> {
        let result = sqlx::query_as!(
            Workflow,
            r#"
            SELECT id, user_id, name, description, data, created_at as "created_at!", updated_at as "updated_at!"
            FROM workflows
            WHERE user_id = $1 AND id = $2
            "#,
            user_id,
            workflow_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn update_workflow(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        name: &str,
        description: Option<&str>,
        data: Value,
    ) -> Result<Option<Workflow>, sqlx::Error> {
        let result = sqlx::query_as!(
            Workflow,
            r#"
            UPDATE workflows
            SET name = $3,
                description = $4,
                data = $5,
                updated_at = now()
            WHERE user_id = $1 AND id = $2
            RETURNING id, user_id, name, description, data, created_at as "created_at!", updated_at as "updated_at!"
            "#,
            user_id,
            workflow_id,
            name,
            description,
            data
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn delete_workflow(&self, user_id: Uuid, workflow_id: Uuid) -> Result<bool, sqlx::Error> {
        let result = sqlx::query!(
            r#"
            DELETE FROM workflows
            WHERE user_id = $1 AND id = $2
            "#,
            user_id,
            workflow_id
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }
}
