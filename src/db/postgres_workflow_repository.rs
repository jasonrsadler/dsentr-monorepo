use crate::{
    db::workflow_repository::WorkflowRepository,
    models::workflow::Workflow,
    models::workflow_log::WorkflowLog,
    models::workflow_node_run::WorkflowNodeRun,
    models::workflow_run::WorkflowRun,
    models::workflow_dead_letter::WorkflowDeadLetter,
};
use async_trait::async_trait;
use serde_json::Value;
use sqlx::{PgPool, Row};
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
        let result = sqlx::query_as::<_, Workflow>(
            r#"
            INSERT INTO workflows (user_id, name, description, data, created_at, updated_at)
            VALUES ($1, $2, $3, $4, now(), now())
            RETURNING id, user_id, name, description, data, concurrency_limit, egress_allowlist, require_hmac, hmac_replay_window_sec, webhook_salt, created_at, updated_at
            "#
        )
        .bind(user_id)
        .bind(name)
        .bind(description)
        .bind(data)
        .fetch_one(&self.pool)
        .await?;

        Ok(result)
    }

    async fn list_workflows_by_user(&self, user_id: Uuid) -> Result<Vec<Workflow>, sqlx::Error> {
        let results = sqlx::query_as::<_, Workflow>(
            r#"
            SELECT id, user_id, name, description, data, concurrency_limit, egress_allowlist, require_hmac, hmac_replay_window_sec, webhook_salt, created_at, updated_at
            FROM workflows
            WHERE user_id = $1
            ORDER BY updated_at DESC
            "#
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(results)
    }

    async fn find_workflow_by_id(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
    ) -> Result<Option<Workflow>, sqlx::Error> {
        let result = sqlx::query_as::<_, Workflow>(
            r#"
            SELECT id, user_id, name, description, data, concurrency_limit, egress_allowlist, require_hmac, hmac_replay_window_sec, webhook_salt, created_at, updated_at
            FROM workflows
            WHERE user_id = $1 AND id = $2
            "#
        )
        .bind(user_id)
        .bind(workflow_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn find_workflow_by_id_public(
        &self,
        workflow_id: Uuid,
    ) -> Result<Option<Workflow>, sqlx::Error> {
        let result = sqlx::query_as::<_, Workflow>(
            r#"
            SELECT id, user_id, name, description, data, concurrency_limit, egress_allowlist, require_hmac, hmac_replay_window_sec, webhook_salt, created_at, updated_at
            FROM workflows
            WHERE id = $1
            "#
        )
        .bind(workflow_id)
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
        let result = sqlx::query_as::<_, Workflow>(
            r#"
            UPDATE workflows
            SET name = $3,
                description = $4,
                data = $5,
                updated_at = now()
            WHERE user_id = $1 AND id = $2
            RETURNING id, user_id, name, description, data, concurrency_limit, egress_allowlist, require_hmac, hmac_replay_window_sec, webhook_salt, created_at, updated_at
            "#
        )
        .bind(user_id)
        .bind(workflow_id)
        .bind(name)
        .bind(description)
        .bind(data)
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
                      wr.started_at, wr.finished_at, wr.created_at, wr.updated_at
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

    async fn update_node_run(
        &self,
        node_run_id: Uuid,
        status: &str,
        outputs: Option<Value>,
        error: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            UPDATE workflow_node_runs
            SET status = $2,
                outputs = $3,
                error = $4,
                finished_at = COALESCE(finished_at, now()),
                updated_at = now()
            WHERE id = $1
            "#,
            node_run_id,
            status,
            outputs,
            error
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn upsert_node_run(
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
        let row = sqlx::query_as::<_, WorkflowNodeRun>(
            r#"
            INSERT INTO workflow_node_runs (run_id, node_id, name, node_type, inputs, outputs, status, error, started_at, finished_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                    now(),
                    CASE WHEN $7 IN ('succeeded','failed','skipped','canceled') THEN now() ELSE NULL END,
                    now(), now())
            ON CONFLICT (run_id, node_id) DO UPDATE SET
                name = COALESCE(EXCLUDED.name, workflow_node_runs.name),
                node_type = COALESCE(EXCLUDED.node_type, workflow_node_runs.node_type),
                inputs = COALESCE(EXCLUDED.inputs, workflow_node_runs.inputs),
                outputs = COALESCE(EXCLUDED.outputs, workflow_node_runs.outputs),
                status = EXCLUDED.status,
                error = COALESCE(EXCLUDED.error, workflow_node_runs.error),
                finished_at = CASE
                    WHEN EXCLUDED.status IN ('succeeded','failed','skipped','canceled') THEN COALESCE(workflow_node_runs.finished_at, now())
                    ELSE workflow_node_runs.finished_at
                END,
                updated_at = now()
            RETURNING id, run_id, node_id, name, node_type, inputs, outputs, status, error,
                      started_at, finished_at, created_at, updated_at
            "#
        )
        .bind(run_id)
        .bind(node_id)
        .bind(name)
        .bind(node_type)
        .bind(inputs)
        .bind(outputs)
        .bind(status)
        .bind(error)
        .fetch_one(&self.pool)
        .await?;
        Ok(row)
    }

    async fn cancel_workflow_run(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        run_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let res = sqlx::query!(
            r#"
            UPDATE workflow_runs
            SET status = 'canceled', finished_at = now(), updated_at = now()
            WHERE id = $1 AND user_id = $2 AND workflow_id = $3 AND status IN ('queued','running')
            "#,
            run_id,
            user_id,
            workflow_id
        )
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn get_run_status(&self, run_id: Uuid) -> Result<Option<String>, sqlx::Error> {
        let row = sqlx::query!(
            r#"
            SELECT status FROM workflow_runs WHERE id = $1
            "#,
            run_id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| r.status))
    }

    async fn list_active_runs(
        &self,
        user_id: Uuid,
        workflow_id: Option<Uuid>,
    ) -> Result<Vec<WorkflowRun>, sqlx::Error> {
        if let Some(wf) = workflow_id {
            let rows = sqlx::query_as!(
                WorkflowRun,
                r#"
                SELECT id, user_id, workflow_id, snapshot, status, error, idempotency_key,
                       started_at as "started_at!", finished_at,
                       created_at as "created_at!", updated_at as "updated_at!"
                FROM workflow_runs
                WHERE user_id = $1
                  AND workflow_id = $2
                  AND status IN ('queued','running')
                ORDER BY started_at ASC
                "#,
                user_id,
                wf
            )
            .fetch_all(&self.pool)
            .await?;
            Ok(rows)
        } else {
            let rows = sqlx::query_as!(
                WorkflowRun,
                r#"
                SELECT id, user_id, workflow_id, snapshot, status, error, idempotency_key,
                       started_at as "started_at!", finished_at,
                       created_at as "created_at!", updated_at as "updated_at!"
                FROM workflow_runs
                WHERE user_id = $1
                  AND status IN ('queued','running')
                ORDER BY started_at ASC
                "#,
                user_id
            )
            .fetch_all(&self.pool)
            .await?;
            Ok(rows)
        }
    }

    async fn list_runs_paged(
        &self,
        user_id: Uuid,
        workflow_id: Option<Uuid>,
        statuses: Option<&[String]>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<WorkflowRun>, sqlx::Error> {
        // Build dynamic WHERE with optional workflow and statuses
        // For statuses, we use ANY($N)
        if let Some(wf) = workflow_id {
            if let Some(sts) = statuses {
                let rows = sqlx::query_as!(
                    WorkflowRun,
                    r#"
                    SELECT id, user_id, workflow_id, snapshot, status, error, idempotency_key,
                           started_at as "started_at!", finished_at,
                           created_at as "created_at!", updated_at as "updated_at!"
                    FROM workflow_runs
                    WHERE user_id = $1 AND workflow_id = $2
                      AND ($3::text[] IS NULL OR status = ANY($3))
                    ORDER BY created_at DESC
                    LIMIT $4 OFFSET $5
                    "#,
                    user_id,
                    wf,
                    sts,
                    limit,
                    offset
                )
                .fetch_all(&self.pool)
                .await?;
                Ok(rows)
            } else {
                let rows = sqlx::query_as!(
                    WorkflowRun,
                    r#"
                    SELECT id, user_id, workflow_id, snapshot, status, error, idempotency_key,
                           started_at as "started_at!", finished_at,
                           created_at as "created_at!", updated_at as "updated_at!"
                    FROM workflow_runs
                    WHERE user_id = $1 AND workflow_id = $2
                    ORDER BY created_at DESC
                    LIMIT $3 OFFSET $4
                    "#,
                    user_id,
                    wf,
                    limit,
                    offset
                )
                .fetch_all(&self.pool)
                .await?;
                Ok(rows)
            }
        } else {
            if let Some(sts) = statuses {
                let rows = sqlx::query_as!(
                    WorkflowRun,
                    r#"
                    SELECT id, user_id, workflow_id, snapshot, status, error, idempotency_key,
                           started_at as "started_at!", finished_at,
                           created_at as "created_at!", updated_at as "updated_at!"
                    FROM workflow_runs
                    WHERE user_id = $1
                      AND ($2::text[] IS NULL OR status = ANY($2))
                    ORDER BY created_at DESC
                    LIMIT $3 OFFSET $4
                    "#,
                    user_id,
                    sts,
                    limit,
                    offset
                )
                .fetch_all(&self.pool)
                .await?;
                Ok(rows)
            } else {
                let rows = sqlx::query_as!(
                    WorkflowRun,
                    r#"
                    SELECT id, user_id, workflow_id, snapshot, status, error, idempotency_key,
                           started_at as "started_at!", finished_at,
                           created_at as "created_at!", updated_at as "updated_at!"
                    FROM workflow_runs
                    WHERE user_id = $1
                    ORDER BY created_at DESC
                    LIMIT $2 OFFSET $3
                    "#,
                    user_id,
                    limit,
                    offset
                )
                .fetch_all(&self.pool)
                .await?;
                Ok(rows)
            }
        }
    }

    async fn cancel_all_runs_for_workflow(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let res = sqlx::query!(
            r#"
            UPDATE workflow_runs
            SET status = 'canceled', finished_at = now(), updated_at = now()
            WHERE user_id = $1 AND workflow_id = $2 AND status IN ('queued','running')
            "#,
            user_id,
            workflow_id
        )
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected())
    }

    async fn set_run_priority(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        run_id: Uuid,
        priority: i32,
    ) -> Result<bool, sqlx::Error> {
        let res = sqlx::query(
            r#"
            UPDATE workflow_runs
            SET queue_priority = $4, updated_at = now()
            WHERE id = $3 AND user_id = $1 AND workflow_id = $2
            "#
        )
        .bind(user_id)
        .bind(workflow_id)
        .bind(run_id)
        .bind(priority)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn set_workflow_concurrency_limit(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        limit: i32,
    ) -> Result<bool, sqlx::Error> {
        let res = sqlx::query(
            r#"
            UPDATE workflows
            SET concurrency_limit = $3, updated_at = now()
            WHERE id = $2 AND user_id = $1
            "#,
        )
        .bind(user_id)
        .bind(workflow_id)
        .bind(limit)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn requeue_expired_leases(&self) -> Result<u64, sqlx::Error> {
        let res = sqlx::query(
            r#"
            UPDATE workflow_runs
            SET status = 'queued', leased_by = NULL, lease_expires_at = NULL
            WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()
            "#
        )
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected())
    }

    async fn claim_next_eligible_run(
        &self,
        worker_id: &str,
        lease_seconds: i32,
    ) -> Result<Option<WorkflowRun>, sqlx::Error> {
        let row = sqlx::query(
            r#"
            WITH sel AS (
              SELECT wr.id
              FROM workflow_runs wr
              JOIN workflows wf ON wf.id = wr.workflow_id
              WHERE wr.status = 'queued'
                AND (
                  SELECT COUNT(*) FROM workflow_runs r2
                  WHERE r2.workflow_id = wr.workflow_id AND r2.status = 'running'
                ) < COALESCE(wf.concurrency_limit, 1)
              ORDER BY COALESCE(wr.queue_priority, 0) DESC, wr.created_at ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            UPDATE workflow_runs wr
            SET status = 'running',
                leased_by = $1,
                heartbeat_at = now(),
                lease_expires_at = now() + ($2::int * INTERVAL '1 second'),
                attempt = COALESCE(wr.attempt, 0) + 1,
                updated_at = now()
            FROM sel
            WHERE wr.id = sel.id
            RETURNING wr.id, wr.user_id, wr.workflow_id, wr.snapshot, wr.status, wr.error, wr.idempotency_key,
                      wr.started_at, wr.finished_at, wr.created_at, wr.updated_at
            "#
        )
        .bind(worker_id)
        .bind(lease_seconds)
        .fetch_optional(&self.pool)
        .await?;
        let mapped = row.map(|r| WorkflowRun {
            id: r.get("id"),
            user_id: r.get("user_id"),
            workflow_id: r.get("workflow_id"),
            snapshot: r.get("snapshot"),
            status: r.get("status"),
            error: r.get("error"),
            idempotency_key: r.get("idempotency_key"),
            started_at: r.get("started_at"),
            finished_at: r.get("finished_at"),
            created_at: r.get("created_at"),
            updated_at: r.get("updated_at"),
        });
        Ok(mapped)
    }

    async fn renew_run_lease(
        &self,
        run_id: Uuid,
        worker_id: &str,
        lease_seconds: i32,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE workflow_runs
            SET heartbeat_at = now(),
                lease_expires_at = now() + ($3::int * INTERVAL '1 second'),
                updated_at = now()
            WHERE id = $1 AND leased_by = $2
            "#
        )
        .bind(run_id)
        .bind(worker_id)
        .bind(lease_seconds)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn purge_old_runs(&self, retention_days: i32) -> Result<u64, sqlx::Error> {
        let res = sqlx::query(
            r#"
            DELETE FROM workflow_runs
            WHERE status IN ('succeeded','failed','canceled')
              AND created_at < now() - ($1::int * INTERVAL '1 day')
            "#
        )
        .bind(retention_days)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected())
    }

    async fn insert_dead_letter(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        run_id: Uuid,
        error: &str,
        snapshot: Value,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO workflow_dead_letters (user_id, workflow_id, run_id, error, snapshot, created_at)
            VALUES ($1, $2, $3, $4, $5, now())
            "#
        )
        .bind(user_id)
        .bind(workflow_id)
        .bind(run_id)
        .bind(error)
        .bind(snapshot)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn list_dead_letters(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<WorkflowDeadLetter>, sqlx::Error> {
        let rows = sqlx::query_as::<_, WorkflowDeadLetter>(
            r#"
            SELECT id, user_id, workflow_id, run_id, error, snapshot, created_at
            FROM workflow_dead_letters
            WHERE user_id = $1 AND workflow_id = $2
            ORDER BY created_at DESC
            LIMIT $3 OFFSET $4
            "#
        )
        .bind(user_id)
        .bind(workflow_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn requeue_dead_letter(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        dead_id: Uuid,
    ) -> Result<Option<WorkflowRun>, sqlx::Error> {
        let maybe = sqlx::query_as::<_, WorkflowDeadLetter>(
            r#"
            SELECT id, user_id, workflow_id, run_id, error, snapshot, created_at
            FROM workflow_dead_letters
            WHERE id = $1 AND user_id = $2 AND workflow_id = $3
            "#
        )
        .bind(dead_id)
        .bind(user_id)
        .bind(workflow_id)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(dl) = maybe {
            // Enqueue a new run with stored snapshot
            let new_run_row = sqlx::query(
                r#"
                INSERT INTO workflow_runs (user_id, workflow_id, snapshot, status, started_at, created_at, updated_at)
                VALUES ($1, $2, $3, 'queued', now(), now(), now())
                RETURNING id, user_id, workflow_id, snapshot, status, error, idempotency_key,
                          started_at, finished_at, created_at, updated_at
                "#
            )
            .bind(user_id)
            .bind(workflow_id)
            .bind(dl.snapshot)
            .fetch_one(&self.pool)
            .await?;
            let new_run = WorkflowRun {
                id: new_run_row.get("id"),
                user_id: new_run_row.get("user_id"),
                workflow_id: new_run_row.get("workflow_id"),
                snapshot: new_run_row.get("snapshot"),
                status: new_run_row.get("status"),
                error: new_run_row.get("error"),
                idempotency_key: new_run_row.get("idempotency_key"),
                started_at: new_run_row.get("started_at"),
                finished_at: new_run_row.get("finished_at"),
                created_at: new_run_row.get("created_at"),
                updated_at: new_run_row.get("updated_at"),
            };

            // Remove dead letter entry
            let _ = sqlx::query(r#"DELETE FROM workflow_dead_letters WHERE id = $1"#)
                .bind(dl.id)
                .execute(&self.pool)
                .await?;

            Ok(Some(new_run))
        } else {
            Ok(None)
        }
    }

    async fn set_egress_allowlist(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        allowlist: &[String],
    ) -> Result<bool, sqlx::Error> {
        let res = sqlx::query(
            r#"
            UPDATE workflows
            SET egress_allowlist = $3::text[], updated_at = now()
            WHERE user_id = $1 AND id = $2
            "#
        )
        .bind(user_id)
        .bind(workflow_id)
        .bind(allowlist)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn update_webhook_config(
        &self,
        user_id: Uuid,
        workflow_id: Uuid,
        require_hmac: bool,
        replay_window_sec: i32,
    ) -> Result<bool, sqlx::Error> {
        let res = sqlx::query(
            r#"
            UPDATE workflows
            SET require_hmac = $3, hmac_replay_window_sec = $4, updated_at = now()
            WHERE user_id = $1 AND id = $2
            "#
        )
        .bind(user_id)
        .bind(workflow_id)
        .bind(require_hmac)
        .bind(replay_window_sec)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn try_record_webhook_signature(
        &self,
        workflow_id: Uuid,
        signature: &str,
    ) -> Result<bool, sqlx::Error> {
        let res = sqlx::query(
            r#"
            INSERT INTO webhook_replays (workflow_id, signature, created_at)
            VALUES ($1, $2, now())
            ON CONFLICT (workflow_id, signature) DO NOTHING
            "#
        )
        .bind(workflow_id)
        .bind(signature)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn purge_old_webhook_replays(&self, older_than_seconds: i64) -> Result<u64, sqlx::Error> {
        let res = sqlx::query(
            r#"
            DELETE FROM webhook_replays
            WHERE created_at < now() - ($1::bigint * INTERVAL '1 second')
            "#
        )
        .bind(older_than_seconds)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected())
    }
}


