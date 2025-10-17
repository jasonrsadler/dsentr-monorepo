use async_trait::async_trait;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::models::workspace::{
    Workspace, WorkspaceInvitation, WorkspaceMembershipSummary, WorkspaceRole,
};

use super::workspace_repository::WorkspaceRepository;

pub struct PostgresWorkspaceRepository {
    pub pool: PgPool,
}

#[async_trait]
impl WorkspaceRepository for PostgresWorkspaceRepository {
    async fn create_workspace(
        &self,
        name: &str,
        created_by: Uuid,
        plan: &str,
    ) -> Result<Workspace, sqlx::Error> {
        sqlx::query_as!(
            Workspace,
            r#"
            INSERT INTO workspaces (name, created_by, owner_id, plan, created_at, updated_at)
            VALUES ($1, $2, $2, $3, now(), now())
            RETURNING id,
                      name,
                      created_by,
                      owner_id,
                      plan,
                      created_at,
                      updated_at,
                      deleted_at as "deleted_at?: OffsetDateTime"
            "#,
            name,
            created_by,
            plan
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn update_workspace_name(
        &self,
        workspace_id: Uuid,
        name: &str,
    ) -> Result<Workspace, sqlx::Error> {
        sqlx::query_as!(
            Workspace,
            r#"
            UPDATE workspaces
            SET name = $2, updated_at = now()
            WHERE id = $1
            RETURNING id,
                      name,
                      created_by,
                      owner_id,
                      plan,
                      created_at,
                      updated_at,
                      deleted_at as "deleted_at?: OffsetDateTime"
            "#,
            workspace_id,
            name
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn find_workspace(&self, workspace_id: Uuid) -> Result<Option<Workspace>, sqlx::Error> {
        sqlx::query_as!(
            Workspace,
            r#"
            SELECT id,
                   name,
                   created_by,
                   owner_id,
                   plan,
                   created_at,
                   updated_at,
                   deleted_at as "deleted_at?: OffsetDateTime"
            FROM workspaces
            WHERE id = $1
            "#,
            workspace_id
        )
        .fetch_optional(&self.pool)
        .await
    }

    async fn add_member(
        &self,
        workspace_id: Uuid,
        user_id: Uuid,
        role: WorkspaceRole,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
            "#,
            workspace_id,
            user_id,
            role as WorkspaceRole
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn set_member_role(
        &self,
        workspace_id: Uuid,
        user_id: Uuid,
        role: WorkspaceRole,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        let result = sqlx::query!(
            r#"
            UPDATE workspace_members
            SET role = $3
            WHERE workspace_id = $1 AND user_id = $2
            "#,
            workspace_id,
            user_id,
            role as WorkspaceRole
        )
        .execute(&mut *tx)
        .await?;

        if result.rows_affected() == 0 {
            tx.rollback().await?;
            return Err(sqlx::Error::RowNotFound);
        }

        if matches!(role, WorkspaceRole::Owner) {
            sqlx::query!(
                r#"
                UPDATE workspaces
                SET owner_id = $2, updated_at = now()
                WHERE id = $1
                "#,
                workspace_id,
                user_id
            )
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        Ok(())
    }

    async fn remove_member(&self, workspace_id: Uuid, user_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2"#,
            workspace_id,
            user_id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn leave_workspace(&self, workspace_id: Uuid, user_id: Uuid) -> Result<(), sqlx::Error> {
        self.remove_member(workspace_id, user_id).await
    }

    async fn revoke_member(
        &self,
        workspace_id: Uuid,
        member_id: Uuid,
        revoked_by: Uuid,
        reason: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        let result = sqlx::query!(
            r#"DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2"#,
            workspace_id,
            member_id
        )
        .execute(&mut *tx)
        .await?;

        if result.rows_affected() == 0 {
            tx.rollback().await?;
            return Err(sqlx::Error::RowNotFound);
        }

        sqlx::query!(
            r#"
            INSERT INTO workspace_member_audit (workspace_id, member_id, action, actor_id, reason)
            VALUES ($1, $2, 'revoked', $3, $4)
            "#,
            workspace_id,
            member_id,
            revoked_by,
            reason
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(())
    }

    async fn list_members(
        &self,
        workspace_id: Uuid,
    ) -> Result<Vec<crate::models::workspace::WorkspaceMember>, sqlx::Error> {
        sqlx::query_as!(
            crate::models::workspace::WorkspaceMember,
            r#"
            SELECT
                m.workspace_id,
                m.user_id,
                m.role as "role: WorkspaceRole",
                m.joined_at,
                u.email,
                u.first_name,
                u.last_name
            FROM workspace_members m
            JOIN users u ON u.id = m.user_id
            WHERE m.workspace_id = $1
            ORDER BY m.joined_at ASC
            "#,
            workspace_id
        )
        .fetch_all(&self.pool)
        .await
    }

    async fn list_memberships_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<WorkspaceMembershipSummary>, sqlx::Error> {
        self.list_user_workspaces(user_id).await
    }

    async fn list_user_workspaces(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<WorkspaceMembershipSummary>, sqlx::Error> {
        let rows = sqlx::query!(
            r#"
            SELECT w.id,
                   w.name,
                   w.created_by,
                   w.owner_id,
                   w.plan,
                   w.created_at,
                   w.updated_at,
                   w.deleted_at as "deleted_at?: OffsetDateTime",
                    m.role as "role: WorkspaceRole"
            FROM workspace_members m
            JOIN workspaces w ON w.id = m.workspace_id
            WHERE m.user_id = $1
              AND w.deleted_at IS NULL
            ORDER BY w.created_at ASC
            "#,
            user_id
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| WorkspaceMembershipSummary {
                workspace: Workspace {
                    id: row.id,
                    name: row.name,
                    created_by: row.created_by,
                    owner_id: row.owner_id,
                    plan: row.plan,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    deleted_at: row.deleted_at,
                },
                role: row.role,
            })
            .collect())
    }

    async fn create_workspace_invitation(
        &self,
        workspace_id: Uuid,
        email: &str,
        role: WorkspaceRole,
        token: &str,
        expires_at: OffsetDateTime,
        created_by: Uuid,
    ) -> Result<WorkspaceInvitation, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceInvitation,
            r#"
            INSERT INTO workspace_invitations (workspace_id, email, role, token, status, expires_at, created_by, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, now())
            RETURNING id,
                      workspace_id,
                      email,
                      role as "role: WorkspaceRole",
                      token,
                      status,
                      expires_at,
                      created_by,
                      created_at,
                      accepted_at,
                      revoked_at,
                      ignored_at as "declined_at?: OffsetDateTime"
            "#,
            workspace_id,
            email,
            role as WorkspaceRole,
            token,
            crate::models::workspace::INVITATION_STATUS_PENDING,
            expires_at,
            created_by
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn list_workspace_invitations(
        &self,
        workspace_id: Uuid,
    ) -> Result<Vec<WorkspaceInvitation>, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceInvitation,
            r#"
            SELECT id,
                   workspace_id,
                   email,
                   role as "role: WorkspaceRole",
                   token,
                   status,
                   expires_at,
                   created_by,
                   created_at,
                   accepted_at,
                   revoked_at,
                   ignored_at as "declined_at?: OffsetDateTime"
            FROM workspace_invitations
            WHERE workspace_id = $1
            ORDER BY created_at DESC
            "#,
            workspace_id
        )
        .fetch_all(&self.pool)
        .await
    }

    async fn revoke_workspace_invitation(&self, invite_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            UPDATE workspace_invitations
            SET revoked_at = now(), status = $2
            WHERE id = $1
              AND status = $3
              AND accepted_at IS NULL
              AND revoked_at IS NULL
            "#,
            invite_id,
            crate::models::workspace::INVITATION_STATUS_REVOKED,
            crate::models::workspace::INVITATION_STATUS_PENDING
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn find_invitation_by_token(
        &self,
        token: &str,
    ) -> Result<Option<WorkspaceInvitation>, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceInvitation,
            r#"
            SELECT id,
                   workspace_id,
                   email,
                   role as "role: WorkspaceRole",
                   token,
                   status,
                   expires_at,
                   created_by,
                   created_at,
                   accepted_at,
                   revoked_at,
                   ignored_at as "declined_at?: OffsetDateTime"
            FROM workspace_invitations
            WHERE token = $1
            "#,
            token
        )
        .fetch_optional(&self.pool)
        .await
    }

    async fn mark_invitation_accepted(&self, invite_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            UPDATE workspace_invitations
            SET accepted_at = now(), status = $2
            WHERE id = $1
              AND status = $3
            "#,
            invite_id,
            crate::models::workspace::INVITATION_STATUS_ACCEPTED,
            crate::models::workspace::INVITATION_STATUS_PENDING
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn mark_invitation_declined(&self, invite_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            UPDATE workspace_invitations
            SET ignored_at = now(), status = $2
            WHERE id = $1
              AND status = $3
            "#,
            invite_id,
            crate::models::workspace::INVITATION_STATUS_DECLINED,
            crate::models::workspace::INVITATION_STATUS_PENDING
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn list_pending_invitations_for_email(
        &self,
        email: &str,
    ) -> Result<Vec<WorkspaceInvitation>, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceInvitation,
            r#"
            SELECT id,
                   workspace_id,
                   email,
                   role as "role: WorkspaceRole",
                   token,
                   status,
                   expires_at,
                   created_by,
                   created_at,
                   accepted_at,
                    revoked_at,
                    ignored_at as "declined_at?: OffsetDateTime"
            FROM workspace_invitations
            WHERE lower(email) = lower($1)
              AND status = $2
              AND expires_at > now()
            ORDER BY created_at DESC
            "#,
            email,
            crate::models::workspace::INVITATION_STATUS_PENDING
        )
        .fetch_all(&self.pool)
        .await
    }
}
