use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::organization::{Organization, OrganizationMember, OrganizationMembershipSummary, OrganizationRole};

use super::organization_repository::OrganizationRepository;

pub struct PostgresOrganizationRepository {
    pub pool: PgPool,
}

#[async_trait]
impl OrganizationRepository for PostgresOrganizationRepository {
    async fn create_organization(
        &self,
        name: &str,
        created_by: Uuid,
    ) -> Result<Organization, sqlx::Error> {
        sqlx::query_as!(
            Organization,
            r#"
            INSERT INTO organizations (name, created_by, created_at, updated_at)
            VALUES ($1, $2, now(), now())
            RETURNING id, name, created_by, created_at, updated_at
            "#,
            name,
            created_by
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn update_organization_name(
        &self,
        organization_id: Uuid,
        name: &str,
    ) -> Result<Organization, sqlx::Error> {
        sqlx::query_as!(
            Organization,
            r#"
            UPDATE organizations
            SET name = $2, updated_at = now()
            WHERE id = $1
            RETURNING id, name, created_by, created_at, updated_at
            "#,
            organization_id,
            name
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn add_member(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        role: OrganizationRole,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            INSERT INTO organization_members (organization_id, user_id, role, joined_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role
            "#,
            organization_id,
            user_id,
            role as OrganizationRole
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn set_member_role(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        role: OrganizationRole,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            UPDATE organization_members
            SET role = $3
            WHERE organization_id = $1 AND user_id = $2
            "#,
            organization_id,
            user_id,
            role as OrganizationRole
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn remove_member(&self, organization_id: Uuid, user_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2"#,
            organization_id,
            user_id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn list_memberships_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<OrganizationMembershipSummary>, sqlx::Error> {
        let rows = sqlx::query!(
            r#"
            SELECT o.id,
                   o.name,
                   o.created_by,
                   o.created_at,
                   o.updated_at,
                   m.role as "role: OrganizationRole"
            FROM organization_members m
            JOIN organizations o ON o.id = m.organization_id
            WHERE m.user_id = $1
            ORDER BY o.created_at ASC
            "#,
            user_id
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| OrganizationMembershipSummary {
                organization: Organization {
                    id: row.id,
                    name: row.name,
                    created_by: row.created_by,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                },
                role: row.role,
            })
            .collect())
    }

    async fn list_members(&self, organization_id: Uuid) -> Result<Vec<OrganizationMember>, sqlx::Error> {
        sqlx::query_as!(
            OrganizationMember,
            r#"
            SELECT organization_id, user_id, role as "role: OrganizationRole", joined_at
            FROM organization_members
            WHERE organization_id = $1
            ORDER BY joined_at ASC
            "#,
            organization_id
        )
        .fetch_all(&self.pool)
        .await
    }
}
