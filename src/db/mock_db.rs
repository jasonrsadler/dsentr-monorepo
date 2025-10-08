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
        Err(sqlx::Error::Protocol("NoopWorkflowRepository not implemented".into()))
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
        Err(sqlx::Error::Protocol("NoopWorkflowRepository not implemented".into()))
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
}
