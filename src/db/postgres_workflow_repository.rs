use crate::{
    db::workflow_repository::WorkflowRepository,
    models::workflow::Workflow,
    models::workflow_log::WorkflowLog,
    models::workflow_node_run::WorkflowNodeRun,
    models::workflow_run::WorkflowRun,
};
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
            RETURNING id, user_id, name, description, data, webhook_salt, created_at as "created_at!", updated_at as "updated_at!"
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
            SELECT id, user_id, name, description, data, webhook_salt, created_at as "created_at!", updated_at as "updated_at!"
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
            SELECT id, user_id, name, description, data, webhook_salt, created_at as "created_at!", updated_at as "updated_at!"
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

    async fn find_workflow_by_id_public(
        &self,
        workflow_id: Uuid,
    ) -> Result<Option<Workflow>, sqlx::Error> {
        let result = sqlx::query_as!(
            Workflow,
            r#"
            SELECT id, user_id, name, description, data, webhook_salt, created_at as "created_at!", updated_at as "updated_at!"
            FROM workflows
            WHERE id = $1
            "#,
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
            RETURNING id, user_id, name, description, data, webhook_salt, created_at as "created_at!", updated_at as "updated_at!"
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

    async fn rotate_webhook_salt(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
    ) -> Result<Option<Uuid>, sqlx::Error> {
        let row = sqlx::query!(
            r#"
            UPDATE workflows
            SET webhook_salt = gen_random_uuid(), updated_at = now()
            WHERE user_id = $1 AND id = $2
            RETURNING webhook_salt
            "#,
            user_id,
            workflow_id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| r.webhook_salt))
    }

    async fn create_workflow_run(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        snapshot: Value,
        idempotency_key: Option<&str>,
    ) -> Result<WorkflowRun, sqlx::Error> {
        // Try insert; if unique violation on idempotency, fetch existing
        let insert_res = sqlx::query_as!(
            WorkflowRun,
            r#"
            INSERT INTO workflow_runs (user_id, workflow_id, snapshot, status, idempotency_key, started_at, created_at, updated_at)
            VALUES ($1, $2, $3, 'queued', $4, now(), now(), now())
            RETURNING id, user_id, workflow_id, snapshot, status, error, idempotency_key,
                      started_at as "started_at!", finished_at, created_at as "created_at!", updated_at as "updated_at!"
            "#,
            user_id,
            workflow_id,
            snapshot,
            idempotency_key
        )
        .fetch_one(&self.pool)
        .await;

        match insert_res {
            Ok(run) => Ok(run),
            Err(e) => {
                // Check for unique violation (idempotency)
                let is_unique = matches!(&e, sqlx::Error::Database(db)
                    if db.code().map(|c| c == "23505").unwrap_or(false));
                if is_unique {
                    // Return the existing run for this key
                    let existing = sqlx::query_as!(
                        WorkflowRun,
                        r#"
                        SELECT id, user_id, workflow_id, snapshot, status, error, idempotency_key,
                               started_at as "started_at!", finished_at, created_at as "created_at!", updated_at as "updated_at!"
                        FROM workflow_runs
                        WHERE user_id = $1 AND workflow_id = $2 AND idempotency_key = $3
                        ORDER BY created_at DESC
                        LIMIT 1
                        "#,
                        user_id,
                        workflow_id,
                        idempotency_key
                    )
                    .fetch_one(&self.pool)
                    .await?;
                    Ok(existing)
                } else {
                    Err(e)
                }
            }
        }
    }

    async fn get_workflow_run(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        run_id: Uuid,
    ) -> Result<Option<WorkflowRun>, sqlx::Error> {
        let row = sqlx::query_as!(
            WorkflowRun,
            r#"
            SELECT id, user_id, workflow_id, snapshot, status, error, idempotency_key,
                   started_at as "started_at!", finished_at, created_at as "created_at!", updated_at as "updated_at!"
            FROM workflow_runs
            WHERE user_id = $1 AND workflow_id = $2 AND id = $3
            "#,
            user_id,
            workflow_id,
            run_id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn list_workflow_node_runs(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        run_id: Uuid,
    ) -> Result<Vec<WorkflowNodeRun>, sqlx::Error> {
        let rows = sqlx::query_as!(
            WorkflowNodeRun,
            r#"
            SELECT nr.id, nr.run_id, nr.node_id, nr.name, nr.node_type, nr.inputs, nr.outputs, nr.status, nr.error,
                   nr.started_at as "started_at!", nr.finished_at, nr.created_at as "created_at!", nr.updated_at as "updated_at!"
            FROM workflow_node_runs nr
            JOIN workflow_runs r ON r.id = nr.run_id
            WHERE r.user_id = $1 AND r.workflow_id = $2 AND r.id = $3
            ORDER BY nr.started_at ASC
            "#,
            user_id,
            workflow_id,
            run_id
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn claim_next_queued_run(&self) -> Result<Option<WorkflowRun>, sqlx::Error> {
        // Atomically claim one queued run and mark as running
        let row = sqlx::query_as!(
            WorkflowRun,
            r#"
            WITH sel AS (
              SELECT id
              FROM workflow_runs
              WHERE status = 'queued'
              ORDER BY created_at ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            UPDATE workflow_runs wr
            SET status = 'running', updated_at = now()
            FROM sel
            WHERE wr.id = sel.id
            RETURNING wr.id, wr.user_id, wr.workflow_id, wr.snapshot, wr.status, wr.error, wr.idempotency_key,
                      wr.started_at as "started_at!", wr.finished_at, wr.created_at as "created_at!", wr.updated_at as "updated_at!"
            "#
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn complete_workflow_run(
        &self,
        run_id: Uuid,
        status: &str,
        error: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            UPDATE workflow_runs
            SET status = $2,
                error = $3,
                finished_at = COALESCE(finished_at, now()),
                updated_at = now()
            WHERE id = $1
            "#,
            run_id,
            status,
            error
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn insert_node_run(
        &self,
        run_id: Uuid,
        node_id: &str,
        name: Option<&str>,
        node_type: Option<&str>,
        inputs: Option<Value>,
        outputs: Option<Value>,
        status: &str,
        error: Option<&str>,
    ) -> Result<WorkflowNodeRun, sqlx::Error> {
        let row = sqlx::query_as!(
            WorkflowNodeRun,
            r#"
            INSERT INTO workflow_node_runs (run_id, node_id, name, node_type, inputs, outputs, status, error, started_at, finished_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                    now(),
                    CASE WHEN $7 IN ('succeeded','failed','skipped','canceled') THEN now() ELSE NULL END,
                    now(), now())
            RETURNING id, run_id, node_id, name, node_type, inputs, outputs, status, error,
                      started_at as "started_at!", finished_at, created_at as "created_at!", updated_at as "updated_at!"
            "#,
            run_id,
            node_id,
            name,
            node_type,
            inputs,
            outputs,
            status,
            error
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(row)
    }
}
