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
        workspace::{Workspace, WorkspaceRole},
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
