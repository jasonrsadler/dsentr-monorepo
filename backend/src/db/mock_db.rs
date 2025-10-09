use crate::models::user::{OauthProvider, PublicUser, User};
use async_trait::async_trait;
use time::OffsetDateTime;
use uuid::Uuid;

use super::user_repository::{UserId, UserRepository};
use crate::db::workflow_repository::WorkflowRepository;
use crate::models::signup::SignupPayload;
use crate::models::workflow::Workflow;
use crate::models::workflow_node_run::WorkflowNodeRun;
use crate::models::workflow_run::WorkflowRun;
use crate::models::workflow_schedule::WorkflowSchedule;
use serde_json::Value;

#[allow(dead_code)]
type MarkVerificationTokenFn =
    Box<dyn Fn(&str, OffsetDateTime) -> Result<Option<Uuid>, sqlx::Error> + Send + Sync>;

#[allow(dead_code)]
pub struct MockDb {
    pub find_user_result: Option<User>,
    pub create_user_result: Option<User>,
    pub should_fail: bool,
    pub mark_verification_token_fn: MarkVerificationTokenFn,
    pub set_user_verified_fn: Box<dyn Fn(Uuid) -> Result<(), sqlx::Error> + Send + Sync>,
    pub insert_early_access_email_fn: Box<dyn Fn(String) -> Result<(), sqlx::Error> + Send + Sync>,
}

impl Default for MockDb {
    fn default() -> Self {
        Self {
            find_user_result: None,
            create_user_result: None,
            should_fail: false,
            mark_verification_token_fn: Box::new(|_, _| Ok(Some(Uuid::new_v4()))), // manually initialize all non-Default fields
            set_user_verified_fn: Box::new(|_| Ok(())),
            insert_early_access_email_fn: Box::new(|_| Ok(())),
        }
    }
}

#[async_trait]
impl UserRepository for MockDb {
    async fn find_user_by_email(&self, _: &str) -> Result<Option<User>, sqlx::Error> {
        if self.should_fail {
            return Err(sqlx::Error::Protocol("Mock DB failure".into()));
        }
        Ok(self.find_user_result.clone())
    }

    async fn create_user_with_oauth(
        &self,
        _: &str,
        _: &str,
        _: &str,
        _: OauthProvider,
    ) -> Result<User, sqlx::Error> {
        match &self.create_user_result {
            Some(user) => Ok(user.clone()),
            None => Err(sqlx::Error::RowNotFound),
        }
    }
    async fn find_user_id_by_email(&self, _: &str) -> Result<Option<UserId>, sqlx::Error> {
        todo!()
    }
    async fn insert_password_reset_token(
        &self,
        _: Uuid,
        _: &str,
        _: time::OffsetDateTime,
    ) -> Result<(), sqlx::Error> {
        todo!()
    }
    async fn find_public_user_by_id(
        &self,
        user_id: Uuid,
    ) -> Result<Option<PublicUser>, sqlx::Error> {
        if let Some(user) = &self.find_user_result {
            if user.id == user_id {
                return Ok(Some(PublicUser {
                    id: user.id,
                    email: user.email.clone(),
                    first_name: user.first_name.clone(),
                    last_name: user.last_name.clone(),
                    role: user.role,
                    plan: user.plan.clone(),
                    company_name: user.company_name.clone(),
                }));
            }
        }
        Ok(None)
    }
    async fn verify_password_reset_token(&self, _: &str) -> Result<Option<Uuid>, sqlx::Error> {
        todo!()
    }
    async fn update_user_password(&self, _: Uuid, _: &str) -> Result<(), sqlx::Error> {
        todo!()
    }
    async fn mark_password_reset_token_used(&self, _: &str) -> Result<(), sqlx::Error> {
        todo!()
    }
    async fn is_email_taken(&self, _: &str) -> Result<bool, sqlx::Error> {
        todo!()
    }
    async fn create_user(
        &self,
        _: &SignupPayload,
        _: &str,
        _: OauthProvider,
    ) -> Result<Uuid, sqlx::Error> {
        todo!()
    }
    async fn insert_verification_token(
        &self,
        _: Uuid,
        _: &str,
        _: time::OffsetDateTime,
    ) -> Result<(), sqlx::Error> {
        todo!()
    }
    async fn cleanup_user_and_token(&self, _: Uuid, _: &str) -> Result<(), sqlx::Error> {
        todo!()
    }
    async fn mark_verification_token_used(
        &self,
        token: &str,
        time: time::OffsetDateTime,
    ) -> Result<Option<Uuid>, sqlx::Error> {
        (self.mark_verification_token_fn)(token, time)
    }
    async fn set_user_verified(&self, user_id: Uuid) -> Result<(), sqlx::Error> {
        (self.set_user_verified_fn)(user_id)
    }
    async fn insert_early_access_email(&self, email: &str) -> Result<(), sqlx::Error> {
        (self.insert_early_access_email_fn)(email.to_string())
    }
}

#[derive(Default)]
pub struct NoopWorkflowRepository;

#[async_trait]
impl WorkflowRepository for NoopWorkflowRepository {
    async fn create_workflow(
        &self,
        _user_id: Uuid,
        _name: &str,
        _description: Option<&str>,
        _data: Value,
    ) -> Result<Workflow, sqlx::Error> {
        unimplemented!("Workflow repository behavior is not part of this test scenario");
    }

    async fn list_workflows_by_user(&self, _user_id: Uuid) -> Result<Vec<Workflow>, sqlx::Error> {
        Ok(vec![])
    }

    async fn find_workflow_by_id(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
    ) -> Result<Option<Workflow>, sqlx::Error> {
        Ok(None)
    }

    async fn find_workflow_by_id_public(
        &self,
        _workflow_id: Uuid,
    ) -> Result<Option<Workflow>, sqlx::Error> {
        Ok(None)
    }

    async fn update_workflow(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _name: &str,
        _description: Option<&str>,
        _data: Value,
    ) -> Result<Option<Workflow>, sqlx::Error> {
        Ok(None)
    }

    async fn delete_workflow(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        Ok(false)
    }

    async fn insert_workflow_log(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _diffs: serde_json::Value,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn list_workflow_logs(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _limit: i64,
        _offset: i64,
    ) -> Result<Vec<crate::models::workflow_log::WorkflowLog>, sqlx::Error> {
        Ok(vec![])
    }

    async fn delete_workflow_log(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _log_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        Ok(false)
    }

    async fn clear_workflow_logs(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        Ok(0)
    }

    async fn create_workflow_run(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _snapshot: Value,
        _idempotency_key: Option<&str>,
    ) -> Result<WorkflowRun, sqlx::Error> {
        Err(sqlx::Error::Protocol(
            "NoopWorkflowRepository not implemented".into(),
        ))
    }

    async fn get_workflow_run(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _run_id: Uuid,
    ) -> Result<Option<WorkflowRun>, sqlx::Error> {
        Ok(None)
    }

    async fn list_workflow_node_runs(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _run_id: Uuid,
    ) -> Result<Vec<WorkflowNodeRun>, sqlx::Error> {
        Ok(vec![])
    }

    async fn claim_next_queued_run(&self) -> Result<Option<WorkflowRun>, sqlx::Error> {
        Ok(None)
    }

    async fn complete_workflow_run(
        &self,
        _run_id: Uuid,
        _status: &str,
        _error: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn insert_node_run(
        &self,
        _run_id: Uuid,
        _node_id: &str,
        _name: Option<&str>,
        _node_type: Option<&str>,
        _inputs: Option<Value>,
        _outputs: Option<Value>,
        _status: &str,
        _error: Option<&str>,
    ) -> Result<WorkflowNodeRun, sqlx::Error> {
        Err(sqlx::Error::Protocol(
            "NoopWorkflowRepository not implemented".into(),
        ))
    }

    async fn update_node_run(
        &self,
        _node_run_id: Uuid,
        _status: &str,
        _outputs: Option<Value>,
        _error: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn upsert_node_run(
        &self,
        _run_id: Uuid,
        _node_id: &str,
        _name: Option<&str>,
        _node_type: Option<&str>,
        _inputs: Option<Value>,
        _outputs: Option<Value>,
        _status: &str,
        _error: Option<&str>,
    ) -> Result<WorkflowNodeRun, sqlx::Error> {
        Err(sqlx::Error::Protocol(
            "NoopWorkflowRepository not implemented".into(),
        ))
    }

    async fn rotate_webhook_salt(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
    ) -> Result<Option<Uuid>, sqlx::Error> {
        Ok(None)
    }

    async fn cancel_workflow_run(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _run_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        Ok(false)
    }

    async fn get_run_status(&self, _run_id: Uuid) -> Result<Option<String>, sqlx::Error> {
        Ok(None)
    }

    async fn list_active_runs(
        &self,
        _user_id: Uuid,
        _workflow_id: Option<Uuid>,
    ) -> Result<Vec<WorkflowRun>, sqlx::Error> {
        Ok(vec![])
    }

    async fn list_runs_paged(
        &self,
        _user_id: Uuid,
        _workflow_id: Option<Uuid>,
        _statuses: Option<&[String]>,
        _limit: i64,
        _offset: i64,
    ) -> Result<Vec<WorkflowRun>, sqlx::Error> {
        Ok(vec![])
    }

    async fn cancel_all_runs_for_workflow(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        Ok(0)
    }

    async fn set_run_priority(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _run_id: Uuid,
        _priority: i32,
    ) -> Result<bool, sqlx::Error> {
        Ok(true)
    }

    async fn set_workflow_concurrency_limit(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _limit: i32,
    ) -> Result<bool, sqlx::Error> {
        Ok(true)
    }

    async fn requeue_expired_leases(&self) -> Result<u64, sqlx::Error> {
        Ok(0)
    }

    async fn upsert_workflow_schedule(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _config: Value,
        _next_run_at: Option<OffsetDateTime>,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn disable_workflow_schedule(&self, _workflow_id: Uuid) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn get_schedule_for_workflow(
        &self,
        _workflow_id: Uuid,
    ) -> Result<Option<WorkflowSchedule>, sqlx::Error> {
        Ok(None)
    }

    async fn list_due_schedules(&self, _limit: i64) -> Result<Vec<WorkflowSchedule>, sqlx::Error> {
        Ok(vec![])
    }

    async fn mark_schedule_run(
        &self,
        _schedule_id: Uuid,
        _last_run_at: OffsetDateTime,
        _next_run_at: Option<OffsetDateTime>,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn claim_next_eligible_run(
        &self,
        _worker_id: &str,
        _lease_seconds: i32,
    ) -> Result<Option<WorkflowRun>, sqlx::Error> {
        Ok(None)
    }

    async fn renew_run_lease(
        &self,
        _run_id: Uuid,
        _worker_id: &str,
        _lease_seconds: i32,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn purge_old_runs(&self, _retention_days: i32) -> Result<u64, sqlx::Error> {
        Ok(0)
    }

    async fn insert_dead_letter(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _run_id: Uuid,
        _error: &str,
        _snapshot: Value,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn list_dead_letters(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _limit: i64,
        _offset: i64,
    ) -> Result<Vec<crate::models::workflow_dead_letter::WorkflowDeadLetter>, sqlx::Error> {
        Ok(vec![])
    }

    async fn requeue_dead_letter(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _dead_id: Uuid,
    ) -> Result<Option<WorkflowRun>, sqlx::Error> {
        Ok(None)
    }

    async fn clear_dead_letters(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        Ok(0)
    }

    async fn set_egress_allowlist(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _allowlist: &[String],
    ) -> Result<bool, sqlx::Error> {
        Ok(true)
    }

    async fn update_webhook_config(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _require_hmac: bool,
        _replay_window_sec: i32,
    ) -> Result<bool, sqlx::Error> {
        Ok(true)
    }

    async fn try_record_webhook_signature(
        &self,
        _workflow_id: Uuid,
        _signature: &str,
    ) -> Result<bool, sqlx::Error> {
        Ok(true)
    }

    async fn purge_old_webhook_replays(
        &self,
        _older_than_seconds: i64,
    ) -> Result<u64, sqlx::Error> {
        Ok(0)
    }

    async fn insert_egress_block_event(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _run_id: Uuid,
        _node_id: &str,
        _url: &str,
        _host: &str,
        _rule: &str,
        _message: &str,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn list_egress_block_events(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _limit: i64,
        _offset: i64,
    ) -> Result<Vec<crate::models::egress_block_event::EgressBlockEvent>, sqlx::Error> {
        Ok(vec![])
    }

    async fn clear_egress_block_events(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        Ok(0)
    }
}
