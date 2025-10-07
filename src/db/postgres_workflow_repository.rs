use crate::{db::workflow_repository::WorkflowRepository, models::workflow::Workflow, models::workflow_log::WorkflowLog};
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

    async fn insert_workflow_log(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        diffs: serde_json::Value,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            INSERT INTO workflow_logs (user_id, workflow_id, diffs)
            VALUES ($1, $2, $3)
            "#,
            user_id,
            workflow_id,
            diffs
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn list_workflow_logs(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<WorkflowLog>, sqlx::Error> {
        let rows = sqlx::query_as!(
            WorkflowLog,
            r#"
            SELECT id, user_id, workflow_id, created_at, diffs
            FROM workflow_logs
            WHERE user_id = $1 AND workflow_id = $2
            ORDER BY created_at DESC
            LIMIT $3 OFFSET $4
            "#,
            user_id,
            workflow_id,
            limit,
            offset
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn delete_workflow_log(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        log_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let res = sqlx::query!(
            r#"
            DELETE FROM workflow_logs
            WHERE user_id = $1 AND workflow_id = $2 AND id = $3
            "#,
            user_id,
            workflow_id,
            log_id
        )
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn clear_workflow_logs(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let res = sqlx::query!(
            r#"
            DELETE FROM workflow_logs
            WHERE user_id = $1 AND workflow_id = $2
            "#,
            user_id,
            workflow_id
        )
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected())
    }
}
