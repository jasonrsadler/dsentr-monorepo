use crate::models::user::{OauthProvider, PublicUser, User};
use async_trait::async_trait;
use std::sync::Mutex;
use time::OffsetDateTime;
use uuid::Uuid;

use super::user_repository::{UserId, UserRepository};
use crate::db::{
    organization_repository::OrganizationRepository, workflow_repository::WorkflowRepository,
    workspace_repository::WorkspaceRepository,
};
use crate::models::organization::{Organization, OrganizationMembershipSummary, OrganizationRole};
use crate::models::signup::SignupPayload;
use crate::models::workflow::Workflow;
use crate::models::workflow_node_run::WorkflowNodeRun;
use crate::models::workflow_run::WorkflowRun;
use crate::models::workflow_schedule::WorkflowSchedule;
use crate::models::workspace::{
    Team, TeamMember, Workspace, WorkspaceMembershipSummary, WorkspaceRole,
};
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
    pub user_settings: Mutex<Value>,
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
            user_settings: Mutex::new(Value::Object(Default::default())),
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
                    onboarded_at: user.onboarded_at,
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

    async fn get_user_settings(&self, _user_id: Uuid) -> Result<Value, sqlx::Error> {
        Ok(self.user_settings.lock().unwrap().clone())
    }

    async fn update_user_settings(
        &self,
        _user_id: Uuid,
        settings: Value,
    ) -> Result<(), sqlx::Error> {
        let mut guard = self.user_settings.lock().unwrap();
        *guard = settings;
        Ok(())
    }

    async fn update_user_plan(&self, _user_id: Uuid, _plan: &str) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn mark_workspace_onboarded(
        &self,
        _user_id: Uuid,
        _onboarded_at: OffsetDateTime,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }
}

#[derive(Default)]
pub struct NoopWorkflowRepository;

#[async_trait]
impl WorkflowRepository for NoopWorkflowRepository {
    async fn create_workflow(
        &self,
        _user_id: Uuid,
        _workspace_id: Option<Uuid>,
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

    async fn set_workflow_workspace(
        &self,
        _user_id: Uuid,
        _workflow_id: Uuid,
        _workspace_id: Option<Uuid>,
    ) -> Result<Option<Workflow>, sqlx::Error> {
        Ok(None)
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

    async fn count_user_runs_since(
        &self,
        _user_id: Uuid,
        _since: OffsetDateTime,
    ) -> Result<i64, sqlx::Error> {
        Ok(0)
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

#[derive(Default)]
pub struct NoopWorkspaceRepository;

#[async_trait]
impl WorkspaceRepository for NoopWorkspaceRepository {
    async fn create_workspace(
        &self,
        name: &str,
        created_by: Uuid,
        organization_id: Option<Uuid>,
    ) -> Result<Workspace, sqlx::Error> {
        Ok(Workspace {
            id: Uuid::new_v4(),
            name: name.to_string(),
            created_by,
            organization_id,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        })
    }

    async fn update_workspace_name(
        &self,
        workspace_id: Uuid,
        name: &str,
    ) -> Result<Workspace, sqlx::Error> {
        Ok(Workspace {
            id: workspace_id,
            name: name.to_string(),
            created_by: created_by_placeholder(),
            organization_id: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        })
    }

    async fn update_workspace_organization(
        &self,
        workspace_id: Uuid,
        organization_id: Option<Uuid>,
    ) -> Result<Workspace, sqlx::Error> {
        Ok(Workspace {
            id: workspace_id,
            name: String::new(),
            created_by: created_by_placeholder(),
            organization_id,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        })
    }

    async fn add_member(
        &self,
        _workspace_id: Uuid,
        _user_id: Uuid,
        _role: WorkspaceRole,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn set_member_role(
        &self,
        _workspace_id: Uuid,
        _user_id: Uuid,
        _role: WorkspaceRole,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn remove_member(&self, _workspace_id: Uuid, _user_id: Uuid) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn list_members(
        &self,
        _workspace_id: Uuid,
    ) -> Result<Vec<crate::models::workspace::WorkspaceMember>, sqlx::Error> {
        Ok(vec![])
    }

    async fn list_memberships_for_user(
        &self,
        _user_id: Uuid,
    ) -> Result<Vec<WorkspaceMembershipSummary>, sqlx::Error> {
        Ok(vec![])
    }

    async fn create_team(&self, workspace_id: Uuid, name: &str) -> Result<Team, sqlx::Error> {
        Ok(Team {
            id: Uuid::new_v4(),
            workspace_id,
            name: name.to_string(),
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        })
    }

    async fn add_team_member(
        &self,
        team_id: Uuid,
        user_id: Uuid,
        added_at: OffsetDateTime,
    ) -> Result<TeamMember, sqlx::Error> {
        Ok(TeamMember {
            team_id,
            user_id,
            added_at,
        })
    }

    async fn list_teams(&self, _workspace_id: Uuid) -> Result<Vec<Team>, sqlx::Error> {
        Ok(vec![])
    }

    async fn list_team_members(&self, _team_id: Uuid) -> Result<Vec<TeamMember>, sqlx::Error> {
        Ok(vec![])
    }

    async fn remove_team_member(&self, _team_id: Uuid, _user_id: Uuid) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn delete_team(&self, _team_id: Uuid) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn list_workspaces_by_organization(
        &self,
        _organization_id: Uuid,
    ) -> Result<Vec<Workspace>, sqlx::Error> {
        Ok(vec![])
    }

    async fn create_workspace_invitation(
        &self,
        workspace_id: Uuid,
        team_id: Option<Uuid>,
        email: &str,
        role: WorkspaceRole,
        token: &str,
        expires_at: OffsetDateTime,
        created_by: Uuid,
    ) -> Result<crate::models::workspace::WorkspaceInvitation, sqlx::Error> {
        Ok(crate::models::workspace::WorkspaceInvitation {
            id: Uuid::new_v4(),
            workspace_id,
            team_id,
            email: email.to_string(),
            role,
            token: token.to_string(),
            expires_at,
            created_by,
            created_at: OffsetDateTime::now_utc(),
            accepted_at: None,
            revoked_at: None,
        })
    }

    async fn list_workspace_invitations(
        &self,
        _workspace_id: Uuid,
    ) -> Result<Vec<crate::models::workspace::WorkspaceInvitation>, sqlx::Error> {
        Ok(vec![])
    }

    async fn revoke_workspace_invitation(&self, _invite_id: Uuid) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn find_invitation_by_token(
        &self,
        _token: &str,
    ) -> Result<Option<crate::models::workspace::WorkspaceInvitation>, sqlx::Error> {
        Ok(None)
    }

    async fn mark_invitation_accepted(&self, _invite_id: Uuid) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn create_team_invite_link(
        &self,
        workspace_id: Uuid,
        team_id: Uuid,
        token: &str,
        created_by: Uuid,
        expires_at: Option<OffsetDateTime>,
        max_uses: Option<i32>,
        allowed_domain: Option<&str>,
    ) -> Result<crate::models::workspace::TeamInviteLink, sqlx::Error> {
        Ok(crate::models::workspace::TeamInviteLink {
            id: Uuid::new_v4(),
            workspace_id,
            team_id,
            token: token.to_string(),
            created_by,
            created_at: OffsetDateTime::now_utc(),
            expires_at,
            max_uses,
            used_count: 0,
            allowed_domain: allowed_domain.map(|s| s.to_string()),
        })
    }

    async fn list_team_invite_links(
        &self,
        _team_id: Uuid,
    ) -> Result<Vec<crate::models::workspace::TeamInviteLink>, sqlx::Error> {
        Ok(vec![])
    }

    async fn revoke_team_invite_link(&self, _link_id: Uuid) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn find_team_invite_by_token(
        &self,
        _token: &str,
    ) -> Result<Option<crate::models::workspace::TeamInviteLink>, sqlx::Error> {
        Ok(None)
    }

    async fn increment_team_invite_use(&self, _link_id: Uuid) -> Result<(), sqlx::Error> {
        Ok(())
    }
}

#[derive(Default)]
pub struct NoopOrganizationRepository;

#[async_trait]
impl OrganizationRepository for NoopOrganizationRepository {
    async fn create_organization(
        &self,
        name: &str,
        created_by: Uuid,
    ) -> Result<Organization, sqlx::Error> {
        Ok(Organization {
            id: Uuid::new_v4(),
            name: name.to_string(),
            created_by,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        })
    }

    async fn update_organization_name(
        &self,
        organization_id: Uuid,
        name: &str,
    ) -> Result<Organization, sqlx::Error> {
        Ok(Organization {
            id: organization_id,
            name: name.to_string(),
            created_by: created_by_placeholder(),
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        })
    }

    async fn add_member(
        &self,
        _organization_id: Uuid,
        _user_id: Uuid,
        _role: OrganizationRole,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn set_member_role(
        &self,
        _organization_id: Uuid,
        _user_id: Uuid,
        _role: OrganizationRole,
    ) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn remove_member(&self, _organization_id: Uuid, _user_id: Uuid) -> Result<(), sqlx::Error> {
        Ok(())
    }

    async fn list_memberships_for_user(
        &self,
        _user_id: Uuid,
    ) -> Result<Vec<OrganizationMembershipSummary>, sqlx::Error> {
        Ok(vec![])
    }

    async fn list_members(
        &self,
        _organization_id: Uuid,
    ) -> Result<Vec<crate::models::organization::OrganizationMember>, sqlx::Error> {
        Ok(vec![])
    }
}

fn created_by_placeholder() -> Uuid {
    Uuid::nil()
}
