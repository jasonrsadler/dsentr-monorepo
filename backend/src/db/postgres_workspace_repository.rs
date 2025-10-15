use async_trait::async_trait;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::models::workspace::{
    Team, TeamMember, Workspace, WorkspaceMembershipSummary, WorkspaceRole,
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
}
