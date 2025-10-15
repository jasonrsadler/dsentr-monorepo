use async_trait::async_trait;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::models::workspace::{
    Team, TeamInviteLink, TeamMember, Workspace, WorkspaceInvitation, WorkspaceMembershipSummary, WorkspaceRole,
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
        organization_id: Option<Uuid>,
    ) -> Result<Workspace, sqlx::Error> {
        sqlx::query_as!(
            Workspace,
            r#"
            INSERT INTO workspaces (name, created_by, organization_id, created_at, updated_at)
            VALUES ($1, $2, $3, now(), now())
            RETURNING id, name, created_by, organization_id, created_at, updated_at
            "#,
            name,
            created_by,
            organization_id
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
            RETURNING id, name, created_by, organization_id, created_at, updated_at
            "#,
            workspace_id,
            name
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn update_workspace_organization(
        &self,
        workspace_id: Uuid,
        organization_id: Option<Uuid>,
    ) -> Result<Workspace, sqlx::Error> {
        sqlx::query_as!(
            Workspace,
            r#"
            UPDATE workspaces
            SET organization_id = $2, updated_at = now()
            WHERE id = $1
            RETURNING id, name, created_by, organization_id, created_at, updated_at
            "#,
            workspace_id,
            organization_id
        )
        .fetch_one(&self.pool)
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
        sqlx::query!(
            r#"
            UPDATE workspace_members
            SET role = $3
            WHERE workspace_id = $1 AND user_id = $2
            "#,
            workspace_id,
            user_id,
            role as WorkspaceRole
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn remove_member(&self, workspace_id: Uuid, user_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"DELETE FROM team_members USING teams WHERE team_members.team_id = teams.id AND teams.workspace_id = $1 AND team_members.user_id = $2"#,
            workspace_id,
            user_id
        )
        .execute(&self.pool)
        .await?;
        sqlx::query!(
            r#"DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2"#,
            workspace_id,
            user_id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn list_members(
        &self,
        workspace_id: Uuid,
    ) -> Result<Vec<crate::models::workspace::WorkspaceMember>, sqlx::Error> {
        sqlx::query_as!(
            crate::models::workspace::WorkspaceMember,
            r#"
            SELECT workspace_id, user_id, role as "role: WorkspaceRole", joined_at
            FROM workspace_members
            WHERE workspace_id = $1
            ORDER BY joined_at ASC
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
        let rows = sqlx::query!(
            r#"
            SELECT w.id,
                   w.name,
                   w.created_by,
                   w.organization_id,
                   w.created_at,
                   w.updated_at,
                    m.role as "role: WorkspaceRole"
            FROM workspace_members m
            JOIN workspaces w ON w.id = m.workspace_id
            WHERE m.user_id = $1
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
                    organization_id: row.organization_id,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                },
                role: row.role,
            })
            .collect())
    }

    async fn create_team(&self, workspace_id: Uuid, name: &str) -> Result<Team, sqlx::Error> {
        sqlx::query_as!(
            Team,
            r#"
            INSERT INTO teams (workspace_id, name, created_at, updated_at)
            VALUES ($1, $2, now(), now())
            RETURNING id, workspace_id, name, created_at, updated_at
            "#,
            workspace_id,
            name
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn add_team_member(
        &self,
        team_id: Uuid,
        user_id: Uuid,
        added_at: OffsetDateTime,
    ) -> Result<TeamMember, sqlx::Error> {
        sqlx::query_as!(
            TeamMember,
            r#"
            INSERT INTO team_members (team_id, user_id, added_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (team_id, user_id) DO UPDATE SET added_at = EXCLUDED.added_at
            RETURNING team_id, user_id, added_at
            "#,
            team_id,
            user_id,
            added_at
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn list_teams(&self, workspace_id: Uuid) -> Result<Vec<Team>, sqlx::Error> {
        sqlx::query_as!(
            Team,
            r#"
            SELECT id, workspace_id, name, created_at, updated_at
            FROM teams
            WHERE workspace_id = $1
            ORDER BY created_at ASC
            "#,
            workspace_id
        )
        .fetch_all(&self.pool)
        .await
    }

    async fn list_team_members(&self, team_id: Uuid) -> Result<Vec<TeamMember>, sqlx::Error> {
        sqlx::query_as!(
            TeamMember,
            r#"
            SELECT team_id, user_id, added_at
            FROM team_members
            WHERE team_id = $1
            ORDER BY added_at ASC
            "#,
            team_id
        )
        .fetch_all(&self.pool)
        .await
    }

    async fn remove_team_member(&self, team_id: Uuid, user_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"DELETE FROM team_members WHERE team_id = $1 AND user_id = $2"#,
            team_id,
            user_id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn delete_team(&self, team_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"DELETE FROM teams WHERE id = $1"#,
            team_id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn list_workspaces_by_organization(
        &self,
        organization_id: Uuid,
    ) -> Result<Vec<Workspace>, sqlx::Error> {
        sqlx::query_as!(
            Workspace,
            r#"
            SELECT id, name, created_by, organization_id, created_at, updated_at
            FROM workspaces
            WHERE organization_id = $1
            ORDER BY created_at ASC
            "#,
            organization_id
        )
        .fetch_all(&self.pool)
        .await
    }

    async fn create_workspace_invitation(
        &self,
        workspace_id: Uuid,
        team_id: Option<Uuid>,
        email: &str,
        role: WorkspaceRole,
        token: &str,
        expires_at: time::OffsetDateTime,
        created_by: Uuid,
    ) -> Result<WorkspaceInvitation, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceInvitation,
            r#"
            INSERT INTO workspace_invitations (workspace_id, team_id, email, role, token, expires_at, created_by, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, now())
            RETURNING id, workspace_id, team_id, email, role as "role: WorkspaceRole", token, expires_at, created_by, created_at, accepted_at, revoked_at
            "#,
            workspace_id,
            team_id,
            email,
            role as WorkspaceRole,
            token,
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
            SELECT id, workspace_id, team_id, email, role as "role: WorkspaceRole", token, expires_at, created_by, created_at, accepted_at, revoked_at
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
            r#"UPDATE workspace_invitations SET revoked_at = now() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL"#,
            invite_id
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
            SELECT id, workspace_id, team_id, email, role as "role: WorkspaceRole", token, expires_at, created_by, created_at, accepted_at, revoked_at
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
            r#"UPDATE workspace_invitations SET accepted_at = now() WHERE id = $1"#,
            invite_id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn create_team_invite_link(
        &self,
        workspace_id: Uuid,
        team_id: Uuid,
        token: &str,
        created_by: Uuid,
        expires_at: Option<time::OffsetDateTime>,
        max_uses: Option<i32>,
        allowed_domain: Option<&str>,
    ) -> Result<TeamInviteLink, sqlx::Error> {
        sqlx::query_as!(
            TeamInviteLink,
            r#"
            INSERT INTO team_invite_links (workspace_id, team_id, token, created_by, created_at, expires_at, max_uses, used_count, allowed_domain)
            VALUES ($1, $2, $3, $4, now(), $5, $6, 0, $7)
            RETURNING id, workspace_id, team_id, token, created_by, created_at, expires_at, max_uses, used_count, allowed_domain
            "#,
            workspace_id,
            team_id,
            token,
            created_by,
            expires_at,
            max_uses,
            allowed_domain
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn list_team_invite_links(&self, team_id: Uuid) -> Result<Vec<TeamInviteLink>, sqlx::Error> {
        sqlx::query_as!(
            TeamInviteLink,
            r#"
            SELECT id, workspace_id, team_id, token, created_by, created_at, expires_at, max_uses, used_count, allowed_domain
            FROM team_invite_links
            WHERE team_id = $1
            ORDER BY created_at DESC
            "#,
            team_id
        )
        .fetch_all(&self.pool)
        .await
    }

    async fn revoke_team_invite_link(&self, link_id: Uuid) -> Result<(), sqlx::Error> {
        // revoke by setting max_uses = 0 and expires_at = now if not already expired
        sqlx::query!(
            r#"UPDATE team_invite_links SET max_uses = 0, expires_at = COALESCE(expires_at, now()) WHERE id = $1"#,
            link_id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn find_team_invite_by_token(&self, token: &str) -> Result<Option<TeamInviteLink>, sqlx::Error> {
        sqlx::query_as!(
            TeamInviteLink,
            r#"
            SELECT id, workspace_id, team_id, token, created_by, created_at, expires_at, max_uses, used_count, allowed_domain
            FROM team_invite_links
            WHERE token = $1
            "#,
            token
        )
        .fetch_optional(&self.pool)
        .await
    }

    async fn increment_team_invite_use(&self, link_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"UPDATE team_invite_links SET used_count = used_count + 1 WHERE id = $1"#,
            link_id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
