use async_trait::async_trait;
use uuid::Uuid;

use crate::models::organization::{Organization, OrganizationMembershipSummary, OrganizationRole};

#[async_trait]
pub trait OrganizationRepository: Send + Sync {
    async fn create_organization(
        &self,
        name: &str,
        created_by: Uuid,
    ) -> Result<Organization, sqlx::Error>;

    async fn update_organization_name(
        &self,
        organization_id: Uuid,
        name: &str,
    ) -> Result<Organization, sqlx::Error>;

    async fn add_member(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        role: OrganizationRole,
    ) -> Result<(), sqlx::Error>;

    async fn list_memberships_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<OrganizationMembershipSummary>, sqlx::Error>;
}
