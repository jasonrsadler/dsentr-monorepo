use async_trait::async_trait;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::models::workspace::{Workspace, WorkspaceMembershipSummary, WorkspaceRole};

#[async_trait]
pub trait WorkspaceRepository: Send + Sync {
    async fn create_workspace(
        &self,
        name: &str,
        created_by: Uuid,
    ) -> Result<Workspace, sqlx::Error>;

    async fn update_workspace_name(
        &self,
        workspace_id: Uuid,
        name: &str,
    ) -> Result<Workspace, sqlx::Error>;

    #[allow(dead_code)]
    async fn find_workspace(&self, workspace_id: Uuid) -> Result<Option<Workspace>, sqlx::Error>;

    async fn add_member(
        &self,
        workspace_id: Uuid,
        user_id: Uuid,
        role: WorkspaceRole,
    ) -> Result<(), sqlx::Error>;

    async fn set_member_role(
        &self,
        workspace_id: Uuid,
        user_id: Uuid,
        role: WorkspaceRole,
    ) -> Result<(), sqlx::Error>;

    async fn remove_member(&self, workspace_id: Uuid, user_id: Uuid) -> Result<(), sqlx::Error>;

    async fn leave_workspace(&self, workspace_id: Uuid, user_id: Uuid) -> Result<(), sqlx::Error>;

    async fn revoke_member(
        &self,
        workspace_id: Uuid,
        member_id: Uuid,
        revoked_by: Uuid,
        reason: Option<&str>,
    ) -> Result<(), sqlx::Error>;

    async fn list_members(
        &self,
        workspace_id: Uuid,
    ) -> Result<Vec<crate::models::workspace::WorkspaceMember>, sqlx::Error>;

    async fn list_memberships_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<WorkspaceMembershipSummary>, sqlx::Error>;

    async fn list_user_workspaces(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<WorkspaceMembershipSummary>, sqlx::Error>;

    // Invitations (email-based)
    async fn create_workspace_invitation(
        &self,
        workspace_id: Uuid,
        email: &str,
        role: WorkspaceRole,
        token: &str,
        expires_at: OffsetDateTime,
        created_by: Uuid,
    ) -> Result<crate::models::workspace::WorkspaceInvitation, sqlx::Error>;

    async fn list_workspace_invitations(
        &self,
        workspace_id: Uuid,
    ) -> Result<Vec<crate::models::workspace::WorkspaceInvitation>, sqlx::Error>;

    async fn revoke_workspace_invitation(&self, invite_id: Uuid) -> Result<(), sqlx::Error>;

    async fn find_invitation_by_token(
        &self,
        token: &str,
    ) -> Result<Option<crate::models::workspace::WorkspaceInvitation>, sqlx::Error>;

    async fn mark_invitation_accepted(&self, invite_id: Uuid) -> Result<(), sqlx::Error>;

    async fn mark_invitation_declined(&self, invite_id: Uuid) -> Result<(), sqlx::Error>;

    async fn list_pending_invitations_for_email(
        &self,
        email: &str,
    ) -> Result<Vec<crate::models::workspace::WorkspaceInvitation>, sqlx::Error>;
}
