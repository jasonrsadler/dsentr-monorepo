use std::env;

use axum::{
    extract::State,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    models::{
        organization::{Organization, OrganizationRole},
        workflow::Workflow,
        workspace::{Team, Workspace, WorkspaceRole},
    },
    responses::JsonResponse,
    routes::auth::session::AuthSession,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct TeamSetup {
    pub name: String,
    #[serde(default)]
    pub member_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanTier {
    Solo,
    Workspace,
    Organization,
}

impl PlanTier {
    fn as_str(&self) -> &'static str {
        match self {
            PlanTier::Solo => "solo",
            PlanTier::Workspace => "workspace",
            PlanTier::Organization => "organization",
        }
    }
}

#[derive(Debug, Serialize, Clone)]
struct PlanOption {
    tier: PlanTier,
    name: &'static str,
    description: &'static str,
    price: String,
}

fn plan_price_from_env(var: &str, default: &str) -> String {
    match env::var(var) {
        Ok(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                default.to_string()
            } else {
                trimmed.to_owned()
            }
        }
        Err(_) => default.to_string(),
    }
}

fn plan_options() -> Vec<PlanOption> {
    vec![
        PlanOption {
            tier: PlanTier::Solo,
            name: "Solo",
            description: "Build personal automations with a single user account.",
            price: "Free".to_string(),
        },
        PlanOption {
            tier: PlanTier::Workspace,
            name: "Workspace",
            description: "Collaborate with your team inside one shared workspace.",
            price: plan_price_from_env("WORKSPACE_PLAN_PRICE", "$29/mo"),
        },
        PlanOption {
            tier: PlanTier::Organization,
            name: "Organization",
            description: "Coordinate multiple workspaces under one organization.",
            price: plan_price_from_env("ORGANIZATION_PLAN_PRICE", "$99/mo"),
        },
    ]
}

#[derive(Debug, Deserialize)]
pub struct CompleteOnboardingPayload {
    pub plan_tier: PlanTier,
    #[serde(default)]
    pub workspace_name: Option<String>,
    #[serde(default)]
    pub organization_name: Option<String>,
    #[serde(default)]
    pub teams: Vec<TeamSetup>,
    #[serde(default)]
    pub shared_workflow_ids: Vec<Uuid>,
}

async fn process_plan_change(
    app_state: &AppState,
    user_id: Uuid,
    payload: &CompleteOnboardingPayload,
    now: OffsetDateTime,
    mark_onboarded: bool,
) -> Result<serde_json::Value, Response> {
    let mut created_workspace: Option<Workspace> = None;
    let mut created_organization: Option<Organization> = None;
    let mut updated_workflows: Vec<Workflow> = Vec::new();
    let mut workspace_id: Option<Uuid> = None;

    match payload.plan_tier {
        PlanTier::Solo => {
            if !payload.shared_workflow_ids.is_empty() {
                return Err(JsonResponse::bad_request(
                    "Solo plans do not support sharing workflows with a workspace",
                )
                .into_response());
            }
        }
        PlanTier::Workspace | PlanTier::Organization => {
            let workspace_name = payload
                .workspace_name
                .as_ref()
                .map(|name| name.trim())
                .filter(|name| !name.is_empty())
                .ok_or_else(|| {
                    JsonResponse::bad_request(
                        "Workspace name is required for this subscription tier",
                    )
                    .into_response()
                })?;

            let mut active_organization: Option<Organization> = None;

            if payload.plan_tier == PlanTier::Organization {
                let organization_name = payload
                    .organization_name
                    .as_ref()
                    .map(|name| name.trim())
                    .filter(|name| !name.is_empty())
                    .ok_or_else(|| {
                        JsonResponse::bad_request(
                            "Organization name is required for the organization tier",
                        )
                        .into_response()
                    })?;

                let existing_memberships = match app_state
                    .organization_repo
                    .list_memberships_for_user(user_id)
                    .await
                {
                    Ok(list) => list,
                    Err(err) => {
                        tracing::error!(
                            "failed to inspect organization memberships during plan change: {:?}",
                            err
                        );
                        return Err(JsonResponse::server_error(
                            "Failed to update organization settings",
                        )
                        .into_response());
                    }
                };

                let organization = existing_memberships
                    .iter()
                    .find(|membership| {
                        membership.organization.created_by == user_id
                            && membership.role == OrganizationRole::Admin
                    })
                    .or_else(|| {
                        existing_memberships
                            .iter()
                            .find(|membership| membership.organization.created_by == user_id)
                    })
                    .or_else(|| {
                        existing_memberships
                            .iter()
                            .find(|membership| membership.role == OrganizationRole::Admin)
                    })
                    .map(|membership| membership.organization.clone());

                let organization = if let Some(mut organization) = organization {
                    if organization.name.trim() != organization_name {
                        organization = match app_state
                            .organization_repo
                            .update_organization_name(organization.id, organization_name)
                            .await
                        {
                            Ok(updated) => updated,
                            Err(err) => {
                                tracing::error!(
                                    "failed to rename organization during plan change: {:?}",
                                    err
                                );
                                return Err(JsonResponse::server_error(
                                    "Failed to update organization",
                                )
                                .into_response());
                            }
                        };
                    }
                    organization
                } else {
                    match app_state
                        .organization_repo
                        .create_organization(organization_name, user_id)
                        .await
                    {
                        Ok(record) => record,
                        Err(err) => {
                            tracing::error!(
                                "failed to create organization during plan change: {:?}",
                                err
                            );
                            return Err(JsonResponse::server_error(
                                "Failed to create organization",
                            )
                            .into_response());
                        }
                    }
                };

                if let Err(err) = app_state
                    .organization_repo
                    .add_member(organization.id, user_id, OrganizationRole::Admin)
                    .await
                {
                    tracing::error!(
                        "failed to add admin membership during plan change: {:?}",
                        err
                    );
                    return Err(JsonResponse::server_error(
                        "Failed to configure organization membership",
                    )
                    .into_response());
                }

                active_organization = Some(organization);
            }

            let organization_id = active_organization.as_ref().map(|org| org.id);

            let existing_memberships = match app_state
                .workspace_repo
                .list_memberships_for_user(user_id)
                .await
            {
                Ok(list) => list,
                Err(err) => {
                    tracing::error!(
                        "failed to inspect workspace memberships during plan change: {:?}",
                        err
                    );
                    return Err(
                        JsonResponse::server_error("Failed to update workspace settings")
                            .into_response(),
                    );
                }
            };

            let mut workspace_was_new = false;
            let mut workspace = if let Some(membership) = existing_memberships
                .iter()
                .find(|membership| {
                    membership.workspace.created_by == user_id
                        && membership.role == WorkspaceRole::Admin
                })
                .or_else(|| {
                    existing_memberships
                        .iter()
                        .find(|membership| membership.workspace.created_by == user_id)
                })
                .or_else(|| {
                    existing_memberships
                        .iter()
                        .find(|membership| membership.role == WorkspaceRole::Admin)
                }) {
                membership.workspace.clone()
            } else {
                workspace_was_new = true;
                match app_state
                    .workspace_repo
                    .create_workspace(workspace_name, user_id, organization_id)
                    .await
                {
                    Ok(record) => record,
                    Err(err) => {
                        tracing::error!("failed to create workspace during plan change: {:?}", err);
                        return Err(JsonResponse::server_error("Failed to create workspace")
                            .into_response());
                    }
                }
            };

            if workspace.name.trim() != workspace_name {
                workspace = match app_state
                    .workspace_repo
                    .update_workspace_name(workspace.id, workspace_name)
                    .await
                {
                    Ok(updated) => updated,
                    Err(err) => {
                        tracing::error!("failed to rename workspace during plan change: {:?}", err);
                        return Err(JsonResponse::server_error("Failed to update workspace")
                            .into_response());
                    }
                };
            }

            if let Some(organization) = &active_organization {
                if workspace.organization_id != Some(organization.id) {
                    workspace = match app_state
                        .workspace_repo
                        .update_workspace_organization(workspace.id, Some(organization.id))
                        .await
                    {
                        Ok(updated) => updated,
                        Err(err) => {
                            tracing::error!(
                                "failed to link workspace to organization during plan change: {:?}",
                                err
                            );
                            return Err(JsonResponse::server_error("Failed to update workspace")
                                .into_response());
                        }
                    };
                }
            } else if !workspace_was_new && workspace.organization_id.is_some() {
                workspace = match app_state
                    .workspace_repo
                    .update_workspace_organization(workspace.id, None)
                    .await
                {
                    Ok(updated) => updated,
                    Err(err) => {
                        tracing::error!(
                            "failed to clear workspace organization during plan change: {:?}",
                            err
                        );
                        return Err(JsonResponse::server_error("Failed to update workspace")
                            .into_response());
                    }
                };
            }

            if let Err(err) = app_state
                .workspace_repo
                .add_member(workspace.id, user_id, WorkspaceRole::Admin)
                .await
            {
                tracing::error!("failed to add onboarding user to workspace: {:?}", err);
                return Err(
                    JsonResponse::server_error("Failed to configure workspace membership")
                        .into_response(),
                );
            }

            workspace_id = Some(workspace.id);
            created_workspace = Some(workspace);
            created_organization = active_organization;
        }
    }

    if let Some(workspace) = &created_workspace {
        for team in &payload.teams {
            let team_name = team.name.trim();
            if team_name.is_empty() {
                continue;
            }

            let created_team = match app_state
                .workspace_repo
                .create_team(workspace.id, team_name)
                .await
            {
                Ok(team) => team,
                Err(err) => {
                    tracing::error!("failed to create team during plan change: {:?}", err);
                    return Err(JsonResponse::server_error("Failed to create team").into_response());
                }
            };

            if let Err(err) = app_state
                .workspace_repo
                .add_team_member(created_team.id, user_id, now)
                .await
            {
                tracing::error!(
                    "failed to add workspace owner to team during plan change: {:?}",
                    err
                );
                return Err(JsonResponse::server_error("Failed to add team member").into_response());
            }

            for member_id in &team.member_ids {
                if *member_id == user_id {
                    continue;
                }

                if let Some(org) = &created_organization {
                    if let Err(err) = app_state
                        .organization_repo
                        .add_member(org.id, *member_id, OrganizationRole::User)
                        .await
                    {
                        tracing::warn!(
                            "failed to add member {} to organization {}: {:?}",
                            member_id,
                            org.id,
                            err
                        );
                    }
                }

                if let Err(err) = app_state
                    .workspace_repo
                    .add_member(workspace.id, *member_id, WorkspaceRole::User)
                    .await
                {
                    tracing::warn!(
                        "failed to add member {} to workspace {}: {:?}",
                        member_id,
                        workspace.id,
                        err
                    );
                    continue;
                }

                if let Err(err) = app_state
                    .workspace_repo
                    .add_team_member(created_team.id, *member_id, now)
                    .await
                {
                    tracing::warn!(
                        "failed to add member {} to team {}: {:?}",
                        member_id,
                        created_team.id,
                        err
                    );
                }
            }
        }
    }

    if let Some(workspace_id) = workspace_id {
        for workflow_id in &payload.shared_workflow_ids {
            match app_state
                .workflow_repo
                .set_workflow_workspace(user_id, *workflow_id, Some(workspace_id))
                .await
            {
                Ok(Some(workflow)) => updated_workflows.push(workflow),
                Ok(None) => {
                    return Err(JsonResponse::not_found("Workflow not found").into_response());
                }
                Err(err) => {
                    tracing::error!(
                        "failed to assign workflow {} to workspace {}: {:?}",
                        workflow_id,
                        workspace_id,
                        err
                    );
                    return Err(
                        JsonResponse::server_error("Failed to assign workflow").into_response()
                    );
                }
            }
        }
    } else if !payload.shared_workflow_ids.is_empty() {
        return Err(JsonResponse::bad_request(
            "Select a workspace-capable plan to share workflows",
        )
        .into_response());
    }

    if let Err(err) = app_state
        .db
        .update_user_plan(user_id, payload.plan_tier.as_str())
        .await
    {
        tracing::error!("failed to update user plan tier: {:?}", err);
        return Err(
            JsonResponse::server_error("Failed to save subscription choice").into_response(),
        );
    }

    if mark_onboarded {
        if let Err(err) = app_state.db.mark_workspace_onboarded(user_id, now).await {
            tracing::error!("failed to mark onboarding completion: {:?}", err);
            return Err(JsonResponse::server_error("Failed to finalize onboarding").into_response());
        }
    }

    let memberships = match app_state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await
    {
        Ok(list) => list,
        Err(err) => {
            tracing::error!("failed to reload workspace memberships: {:?}", err);
            Vec::new()
        }
    };

    let organization_memberships = match app_state
        .organization_repo
        .list_memberships_for_user(user_id)
        .await
    {
        Ok(list) => list,
        Err(err) => {
            tracing::error!("failed to reload organization memberships: {:?}", err);
            Vec::new()
        }
    };

    Ok(json!({
        "success": true,
        "plan": payload.plan_tier,
        "workspace": created_workspace,
        "organization": created_organization,
        "memberships": memberships,
        "organization_memberships": organization_memberships,
        "shared_workflows": updated_workflows,
    }))
}

pub async fn get_onboarding_context(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let user = match app_state.db.find_public_user_by_id(user_id).await {
        Ok(Some(user)) => user,
        Ok(None) => return JsonResponse::not_found("User not found").into_response(),
        Err(err) => {
            tracing::error!("failed to fetch user for onboarding context: {:?}", err);
            return JsonResponse::server_error("Failed to load onboarding context").into_response();
        }
    };

    let workflows = match app_state
        .workflow_repo
        .list_workflows_by_user(user_id)
        .await
    {
        Ok(list) => list,
        Err(err) => {
            tracing::error!(
                "failed to fetch workflows for onboarding context: {:?}",
                err
            );
            return JsonResponse::server_error("Failed to load onboarding context").into_response();
        }
    };

    let memberships = match app_state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await
    {
        Ok(list) => list,
        Err(err) => {
            tracing::error!("failed to fetch workspace memberships: {:?}", err);
            return JsonResponse::server_error("Failed to load onboarding context").into_response();
        }
    };

    let organization_memberships = match app_state
        .organization_repo
        .list_memberships_for_user(user_id)
        .await
    {
        Ok(list) => list,
        Err(err) => {
            tracing::error!("failed to fetch organization memberships: {:?}", err);
            return JsonResponse::server_error("Failed to load onboarding context").into_response();
        }
    };

    let plans = plan_options();

    Json(json!({
        "success": true,
        "user": user,
        "workflows": workflows,
        "memberships": memberships,
        "organization_memberships": organization_memberships,
        "plan_options": plans,
    }))
    .into_response()
}

pub async fn complete_onboarding(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Json(payload): Json<CompleteOnboardingPayload>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let now = OffsetDateTime::now_utc();

    match process_plan_change(&app_state, user_id, &payload, now, true).await {
        Ok(value) => Json(value).into_response(),
        Err(response) => response,
    }
}

pub async fn change_plan(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Json(payload): Json<CompleteOnboardingPayload>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let now = OffsetDateTime::now_utc();

    match process_plan_change(&app_state, user_id, &payload, now, false).await {
        Ok(value) => Json(value).into_response(),
        Err(response) => response,
    }
}

// --- Workspace members management ---

#[derive(Debug, Deserialize)]
pub struct AddWorkspaceMemberPayload {
    pub user_id: Uuid,
    pub role: WorkspaceRole,
}

#[derive(Debug, Deserialize)]
pub struct UpdateWorkspaceMemberRolePayload {
    pub role: WorkspaceRole,
}

fn is_admin_or_owner(role: WorkspaceRole) -> bool {
    matches!(role, WorkspaceRole::Owner | WorkspaceRole::Admin)
}

async fn require_workspace_admin(
    app_state: &AppState,
    acting_user: Uuid,
    workspace_id: Uuid,
) -> Result<(), Response> {
    let memberships = app_state
        .workspace_repo
        .list_memberships_for_user(acting_user)
        .await
        .map_err(|_| JsonResponse::server_error("Failed to load memberships").into_response())?;
    for m in memberships {
        if m.workspace.id == workspace_id && is_admin_or_owner(m.role) {
            return Ok(());
        }
    }
    Err(JsonResponse::forbidden("Admin permissions required").into_response())
}

pub async fn list_workspace_members(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path(workspace_id): axum::extract::Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await {
        return resp;
    }
    match app_state.workspace_repo.list_members(workspace_id).await {
        Ok(members) => Json(json!({"success": true, "members": members})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to list members").into_response(),
    }
}

pub async fn add_workspace_member(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path(workspace_id): axum::extract::Path<Uuid>,
    Json(payload): Json<AddWorkspaceMemberPayload>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await {
        return resp;
    }
    if payload.role == WorkspaceRole::Owner {
        // rely on DB unique partial index to enforce single owner; attempt is allowed
    }
    match app_state
        .workspace_repo
        .add_member(workspace_id, payload.user_id, payload.role)
        .await
    {
        Ok(_) => Json(json!({"success": true})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to add member").into_response(),
    }
}

pub async fn update_workspace_member_role(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path((workspace_id, member_id)): axum::extract::Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateWorkspaceMemberRolePayload>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await {
        return resp;
    }
    match app_state
        .workspace_repo
        .set_member_role(workspace_id, member_id, payload.role)
        .await
    {
        Ok(_) => Json(json!({"success": true})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to update role").into_response(),
    }
}

pub async fn remove_workspace_member(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path((workspace_id, member_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await {
        return resp;
    }
    match app_state
        .workspace_repo
        .remove_member(workspace_id, member_id)
        .await
    {
        Ok(_) => Json(json!({"success": true})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to remove member").into_response(),
    }
}

// --- Teams management ---

pub async fn list_workspace_teams(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path(workspace_id): axum::extract::Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await {
        return resp;
    }
    match app_state.workspace_repo.list_teams(workspace_id).await {
        Ok(teams) => Json(json!({"success": true, "teams": teams})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to list teams").into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateTeamPayload { pub name: String }

pub async fn create_workspace_team(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path(workspace_id): axum::extract::Path<Uuid>,
    Json(payload): Json<CreateTeamPayload>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await {
        return resp;
    }
    match app_state
        .workspace_repo
        .create_team(workspace_id, payload.name.trim())
        .await
    {
        Ok(team) => Json(json!({"success": true, "team": team})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to create team").into_response(),
    }
}

pub async fn delete_workspace_team(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path((workspace_id, team_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await {
        return resp;
    }
    match app_state.workspace_repo.delete_team(team_id).await {
        Ok(_) => Json(json!({"success": true})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to delete team").into_response(),
    }
}

pub async fn list_team_members(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path((workspace_id, team_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await {
        return resp;
    }
    match app_state.workspace_repo.list_team_members(team_id).await {
        Ok(members) => Json(json!({"success": true, "members": members})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to list team members").into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct AddTeamMemberPayload { pub user_id: Uuid }

pub async fn add_team_member(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path((workspace_id, team_id)): axum::extract::Path<(Uuid, Uuid)>,
    Json(payload): Json<AddTeamMemberPayload>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await {
        return resp;
    }
    let now = OffsetDateTime::now_utc();
    match app_state
        .workspace_repo
        .add_team_member(team_id, payload.user_id, now)
        .await
    {
        Ok(tm) => Json(json!({"success": true, "member": tm})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to add team member").into_response(),
    }
}

pub async fn remove_team_member(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path((workspace_id, team_id, member_id)): axum::extract::Path<(Uuid, Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await {
        return resp;
    }
    match app_state.workspace_repo.remove_team_member(team_id, member_id).await {
        Ok(_) => Json(json!({"success": true})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to remove team member").into_response(),
    }
}

// --- Organization workspace listing & downgrade flows ---

#[derive(Debug, Deserialize)]
pub struct OrgDowngradePreviewPayload {
    pub organization_id: Uuid,
    pub target_workspace_id: Uuid,
}

// --- Email-based invitations ---

#[derive(Debug, Deserialize)]
pub struct CreateInvitationPayload {
    pub email: String,
    pub role: WorkspaceRole,
    #[serde(default)]
    pub team_id: Option<Uuid>,
    #[serde(default)]
    pub expires_in_days: Option<i32>,
}

fn random_token() -> String {
    Uuid::new_v4().to_string().replace('-', "")
}

pub async fn create_workspace_invitation(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path(workspace_id): axum::extract::Path<Uuid>,
    Json(payload): Json<CreateInvitationPayload>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) { Ok(id) => id, Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response() };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await { return resp; }

    let email = payload.email.trim();
    if email.is_empty() { return JsonResponse::bad_request("Email is required").into_response(); }
    let expires_days = payload.expires_in_days.unwrap_or(14).max(1).min(60);
    let expires_at = OffsetDateTime::now_utc() + time::Duration::days(expires_days.into());

    let token = random_token();
    let invite = match app_state
        .workspace_repo
        .create_workspace_invitation(
            workspace_id,
            payload.team_id,
            email,
            payload.role,
            &token,
            expires_at,
            user_id,
        )
        .await
    {
        Ok(inv) => inv,
        Err(err) => {
            tracing::error!(?err, "failed to create invitation");
            return JsonResponse::server_error("Failed to create invitation").into_response();
        }
    };

    // Send email with invite link
    let frontend = &app_state.config.frontend_origin;
    let accept_url = format!("{}/login?invite={}", frontend, invite.token);
    let subject = format!("You're invited to join {} on DSentr", workspace_id);
    let body = format!(
        "You've been invited to join a workspace on DSentr.\n\nOpen this link to accept: {}\n\nThis link expires in {} days.",
        accept_url, expires_days
    );
    if let Err(err) = app_state.mailer.send_email_generic(email, &subject, &body).await {
        tracing::warn!(?err, "failed to send invitation email");
    }

    Json(json!({"success": true, "invitation": invite})).into_response()
}

pub async fn list_workspace_invitations(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path(workspace_id): axum::extract::Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) { Ok(id) => id, Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response() };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await { return resp; }
    match app_state.workspace_repo.list_workspace_invitations(workspace_id).await {
        Ok(list) => Json(json!({"success": true, "invitations": list})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to list invitations").into_response(),
    }
}

pub async fn revoke_workspace_invitation(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path((workspace_id, invite_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) { Ok(id) => id, Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response() };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await { return resp; }
    match app_state.workspace_repo.revoke_workspace_invitation(invite_id).await {
        Ok(_) => Json(json!({"success": true})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to revoke invitation").into_response(),
    }
}

// Public: preview invite
pub async fn preview_invitation(State(app_state): State<AppState>, axum::extract::Path(token): axum::extract::Path<String>) -> Response {
    match app_state.workspace_repo.find_invitation_by_token(&token).await {
        Ok(Some(inv)) => {
            let now = OffsetDateTime::now_utc();
            let expired = inv.expires_at <= now;
            let revoked = inv.revoked_at.is_some();
            let accepted = inv.accepted_at.is_some();
            Json(json!({
                "success": true,
                "invitation": inv,
                "expired": expired,
                "revoked": revoked,
                "accepted": accepted,
            })).into_response()
        }
        Ok(None) => JsonResponse::not_found("Invalid or expired token").into_response(),
        Err(_) => JsonResponse::server_error("Failed to lookup invite").into_response(),
    }
}

// Public: accept invite (requires login)
pub async fn accept_invitation(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path(token): axum::extract::Path<String>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) { Ok(id) => id, Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response() };
    let invite = match app_state.workspace_repo.find_invitation_by_token(&token).await {
        Ok(Some(i)) => i,
        Ok(None) => return JsonResponse::not_found("Invite not found").into_response(),
        Err(_) => return JsonResponse::server_error("Failed to load invite").into_response(),
    };
    let now = OffsetDateTime::now_utc();
    if invite.revoked_at.is_some() || invite.accepted_at.is_some() || invite.expires_at <= now {
        return JsonResponse::bad_request("Invitation is not valid").into_response();
    }
    // Add workspace membership and optional team membership
    let _ = app_state
        .workspace_repo
        .add_member(invite.workspace_id, user_id, invite.role)
        .await;
    if let Some(team_id) = invite.team_id {
        let _ = app_state
            .workspace_repo
            .add_team_member(team_id, user_id, now)
            .await;
    }
    let _ = app_state
        .workspace_repo
        .mark_invitation_accepted(invite.id)
        .await;
    Json(json!({"success": true})).into_response()
}

// --- Team shareable join links ---

#[derive(Debug, Deserialize)]
pub struct CreateJoinLinkPayload {
    #[serde(default)]
    pub expires_in_days: Option<i32>,
    #[serde(default)]
    pub max_uses: Option<i32>,
    #[serde(default)]
    pub allowed_domain: Option<String>,
}

pub async fn create_team_join_link(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path((workspace_id, team_id)): axum::extract::Path<(Uuid, Uuid)>,
    Json(payload): Json<CreateJoinLinkPayload>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) { Ok(id) => id, Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response() };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await { return resp; }
    let token = random_token();
    let expires_at = payload
        .expires_in_days
        .and_then(|d| Some(OffsetDateTime::now_utc() + time::Duration::days(d.max(1).min(180).into())));
    match app_state
        .workspace_repo
        .create_team_invite_link(
            workspace_id,
            team_id,
            &token,
            user_id,
            expires_at,
            payload.max_uses,
            payload.allowed_domain.as_deref(),
        )
        .await
    {
        Ok(link) => Json(json!({"success": true, "link": link})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to create join link").into_response(),
    }
}

pub async fn list_team_join_links(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path((workspace_id, team_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) { Ok(id) => id, Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response() };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await { return resp; }
    match app_state.workspace_repo.list_team_invite_links(team_id).await {
        Ok(list) => Json(json!({"success": true, "links": list})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to list links").into_response(),
    }
}

pub async fn revoke_team_join_link(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path((workspace_id, _team_id, link_id)): axum::extract::Path<(Uuid, Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) { Ok(id) => id, Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response() };
    if let Err(resp) = require_workspace_admin(&app_state, user_id, workspace_id).await { return resp; }
    match app_state.workspace_repo.revoke_team_invite_link(link_id).await {
        Ok(_) => Json(json!({"success": true})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to revoke link").into_response(),
    }
}

// Public: preview team join
pub async fn preview_join_link(State(app_state): State<AppState>, axum::extract::Path(token): axum::extract::Path<String>) -> Response {
    match app_state.workspace_repo.find_team_invite_by_token(&token).await {
        Ok(Some(link)) => {
            let now = OffsetDateTime::now_utc();
            let expired = link.expires_at.map(|e| e <= now).unwrap_or(false);
            let capped = link.max_uses.map(|m| m > 0 && link.used_count >= m).unwrap_or(false);
            Json(json!({"success": true, "link": link, "expired": expired, "exhausted": capped})).into_response()
        }
        Ok(None) => JsonResponse::not_found("Invalid token").into_response(),
        Err(_) => JsonResponse::server_error("Failed to load link").into_response(),
    }
}

// Public: accept team join (requires login)
pub async fn accept_join_link(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path(token): axum::extract::Path<String>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) { Ok(id) => id, Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response() };
    let link = match app_state.workspace_repo.find_team_invite_by_token(&token).await {
        Ok(Some(l)) => l,
        Ok(None) => return JsonResponse::not_found("Link not found").into_response(),
        Err(_) => return JsonResponse::server_error("Failed to load link").into_response(),
    };
    let now = OffsetDateTime::now_utc();
    if link.expires_at.map(|e| e <= now).unwrap_or(false) { return JsonResponse::bad_request("Link expired").into_response(); }
    if link.max_uses.map(|m| m > 0 && link.used_count >= m).unwrap_or(false) { return JsonResponse::bad_request("Link exhausted").into_response(); }
    // Domain restriction if configured
    if let Some(domain) = link.allowed_domain.as_ref() {
        if let Some(user) = app_state.db.find_public_user_by_id(user_id).await.ok().flatten() {
            if let Some(pos) = user.email.rfind('@') {
                let user_domain = user.email[pos+1..].to_lowercase();
                if user_domain != domain.to_lowercase() {
                    return JsonResponse::forbidden("Email domain not allowed for this link").into_response();
                }
            }
        }
    }
    let _ = app_state
        .workspace_repo
        .add_member(link.workspace_id, user_id, WorkspaceRole::User)
        .await;
    let _ = app_state
        .workspace_repo
        .add_team_member(link.team_id, user_id, now)
        .await;
    let _ = app_state.workspace_repo.increment_team_invite_use(link.id).await;
    Json(json!({"success": true})).into_response()
}

#[derive(Debug, Serialize)]
pub struct OrgDowngradePreviewResult {
    pub target_workspace: Workspace,
    pub teams: Vec<Team>,
    pub will_disable_users: Vec<Uuid>,
}

async fn require_org_admin(
    app_state: &AppState,
    acting_user: Uuid,
    organization_id: Uuid,
) -> Result<(), Response> {
    let org_memberships = app_state
        .organization_repo
        .list_memberships_for_user(acting_user)
        .await
        .map_err(|_| JsonResponse::server_error("Failed to load org memberships").into_response())?;
    let mut ok = false;
    for m in org_memberships {
        if m.organization.id == organization_id {
            ok = matches!(m.role, OrganizationRole::Owner | OrganizationRole::Admin);
            break;
        }
    }
    if ok { Ok(()) } else { Err(JsonResponse::forbidden("Admin permissions required").into_response()) }
}

pub async fn org_downgrade_preview(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Json(payload): Json<OrgDowngradePreviewPayload>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = require_org_admin(&app_state, user_id, payload.organization_id).await {
        return resp;
    }

    // Fetch target workspace and validate it belongs to org
    let workspaces = match app_state
        .workspace_repo
        .list_workspaces_by_organization(payload.organization_id)
        .await
    {
        Ok(ws) => ws,
        Err(_) => return JsonResponse::server_error("Failed to list org workspaces").into_response(),
    };
    let target = match workspaces.iter().find(|w| w.id == payload.target_workspace_id) {
        Some(w) => w.clone(),
        None => return JsonResponse::bad_request("Workspace does not belong to organization").into_response(),
    };

    // Gather org members and target members
    let org_members = match app_state
        .organization_repo
        .list_members(payload.organization_id)
        .await
    {
        Ok(ms) => ms,
        Err(_) => return JsonResponse::server_error("Failed to list org members").into_response(),
    };
    let target_members = match app_state.workspace_repo.list_members(target.id).await {
        Ok(ms) => ms,
        Err(_) => return JsonResponse::server_error("Failed to list workspace members").into_response(),
    };
    let target_member_ids: std::collections::HashSet<_> =
        target_members.iter().map(|m| m.user_id).collect();

    let will_disable: Vec<Uuid> = org_members
        .iter()
        .map(|m| m.user_id)
        .filter(|uid| !target_member_ids.contains(uid))
        .collect();

    let teams = match app_state.workspace_repo.list_teams(target.id).await {
        Ok(ts) => ts,
        Err(_) => return JsonResponse::server_error("Failed to list teams").into_response(),
    };

    Json(json!({
        "success": true,
        "target_workspace": target,
        "teams": teams,
        "will_disable_users": will_disable,
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
pub struct OrgDowngradeExecutePayload {
    pub organization_id: Uuid,
    pub target_workspace_id: Uuid,
    #[serde(default)]
    pub transfers: Vec<TransferUser>,
}

#[derive(Debug, Deserialize)]
pub struct TransferUser {
    pub user_id: Uuid,
    pub team_id: Option<Uuid>,
}

pub async fn org_downgrade_execute(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Json(payload): Json<OrgDowngradeExecutePayload>,
) -> Response {
    let acting_user = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = require_org_admin(&app_state, acting_user, payload.organization_id).await {
        return resp;
    }

    // Validate target workspace
    let workspaces = match app_state
        .workspace_repo
        .list_workspaces_by_organization(payload.organization_id)
        .await
    {
        Ok(ws) => ws,
        Err(_) => return JsonResponse::server_error("Failed to list org workspaces").into_response(),
    };
    if workspaces.iter().all(|w| w.id != payload.target_workspace_id) {
        return JsonResponse::bad_request("Workspace does not belong to organization").into_response();
    }

    // Make sure acting user is at least a member of target workspace (and ideally becomes/keeps Owner)
    let _ = app_state
        .workspace_repo
        .add_member(payload.target_workspace_id, acting_user, WorkspaceRole::Owner)
        .await;

    // Determine org members and target members
    let org_members = match app_state
        .organization_repo
        .list_members(payload.organization_id)
        .await
    {
        Ok(ms) => ms,
        Err(_) => return JsonResponse::server_error("Failed to list org members").into_response(),
    };
    let target_members = match app_state
        .workspace_repo
        .list_members(payload.target_workspace_id)
        .await
    {
        Ok(ms) => ms,
        Err(_) => return JsonResponse::server_error("Failed to list workspace members").into_response(),
    };
    let target_member_ids: std::collections::HashSet<_> =
        target_members.iter().map(|m| m.user_id).collect();

    let transfers_map: std::collections::HashMap<Uuid, Option<Uuid>> =
        payload.transfers.iter().map(|t| (t.user_id, t.team_id)).collect();

    // Remove org memberships for everyone (org is kept for later re-upgrade)
    for m in &org_members {
        let _ = app_state
            .organization_repo
            .remove_member(payload.organization_id, m.user_id)
            .await;
    }

    // For each workspace in org except target, remove memberships
    for ws in &workspaces {
        if ws.id == payload.target_workspace_id {
            continue;
        }
        // List members of this workspace and remove them to disable access
        if let Ok(members) = app_state.workspace_repo.list_members(ws.id).await {
            for wm in members {
                let _ = app_state.workspace_repo.remove_member(ws.id, wm.user_id).await;
            }
        }
    }

    // For users not already in target workspace, transfer if requested
    for m in &org_members {
        if target_member_ids.contains(&m.user_id) {
            continue;
        }
        if let Some(team_choice) = transfers_map.get(&m.user_id) {
            // Add as a user to target workspace
            let _ = app_state
                .workspace_repo
                .add_member(payload.target_workspace_id, m.user_id, WorkspaceRole::User)
                .await;
            if let Some(team_id) = team_choice.clone() {
                let _ = app_state
                    .workspace_repo
                    .add_team_member(team_id, m.user_id, OffsetDateTime::now_utc())
                    .await;
            }
        }
    }

    // Update acting admin's plan to workspace
    let _ = app_state
        .db
        .update_user_plan(acting_user, PlanTier::Workspace.as_str())
        .await;

    Json(json!({"success": true})).into_response()
}

// Workspace -> Solo downgrade

#[derive(Debug, Deserialize)]
pub struct WorkspaceToSoloPreviewPayload { pub workspace_id: Uuid }

pub async fn workspace_to_solo_preview(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Json(payload): Json<WorkspaceToSoloPreviewPayload>,
) -> Response {
    let acting = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = require_workspace_admin(&app_state, acting, payload.workspace_id).await {
        return resp;
    }
    match app_state.workspace_repo.list_members(payload.workspace_id).await {
        Ok(members) => {
            let to_disable: Vec<Uuid> = members
                .into_iter()
                .filter(|m| m.user_id != acting)
                .map(|m| m.user_id)
                .collect();
            Json(json!({"success": true, "will_disable_users": to_disable})).into_response()
        }
        Err(_) => JsonResponse::server_error("Failed to list members").into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct WorkspaceToSoloExecutePayload { pub workspace_id: Uuid }

pub async fn workspace_to_solo_execute(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Json(payload): Json<WorkspaceToSoloExecutePayload>,
) -> Response {
    let acting = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = require_workspace_admin(&app_state, acting, payload.workspace_id).await {
        return resp;
    }
    // Remove all members except acting user
    if let Ok(members) = app_state.workspace_repo.list_members(payload.workspace_id).await {
        for m in members {
            if m.user_id == acting { continue; }
            let _ = app_state.workspace_repo.remove_member(payload.workspace_id, m.user_id).await;
        }
    }
    let _ = app_state
        .db
        .update_user_plan(acting, PlanTier::Solo.as_str())
        .await;
    Json(json!({"success": true})).into_response()
}
