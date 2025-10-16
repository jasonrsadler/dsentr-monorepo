use std::env;

use axum::{
    extract::State,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use urlencoding::encode;
use uuid::Uuid;

use crate::{
    models::{
        workflow::Workflow,
        workspace::{Workspace, WorkspaceRole},
    },
    responses::JsonResponse,
    routes::auth::session::AuthSession,
    state::AppState,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanTier {
    Solo,
    Workspace,
}

impl PlanTier {
    fn as_str(&self) -> &'static str {
        match self {
            PlanTier::Solo => "solo",
            PlanTier::Workspace => "workspace",
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
    ]
}

#[derive(Debug, Deserialize)]
pub struct CompleteOnboardingPayload {
    pub plan_tier: PlanTier,
    #[serde(default)]
    pub workspace_name: Option<String>,
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
        PlanTier::Workspace => {
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

            let mut workspace = if let Some(membership) = existing_memberships
                .iter()
                .find(|membership| {
                    membership.workspace.created_by == user_id
                        && matches!(membership.role, WorkspaceRole::Owner | WorkspaceRole::Admin)
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
                match app_state
                    .workspace_repo
                    .create_workspace(workspace_name, user_id)
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

            let workspace_members = match app_state.workspace_repo.list_members(workspace.id).await
            {
                Ok(members) => members,
                Err(err) => {
                    tracing::warn!(
                        "failed to inspect workspace members during plan change: {:?}",
                        err
                    );
                    Vec::new()
                }
            };

            for member in workspace_members
                .iter()
                .filter(|m| m.role == WorkspaceRole::Owner && m.user_id != user_id)
            {
                if let Err(err) = app_state
                    .workspace_repo
                    .set_member_role(workspace.id, member.user_id, WorkspaceRole::Admin)
                    .await
                {
                    tracing::error!(
                        "failed to reassign workspace owner during plan change: {:?}",
                        err
                    );
                    return Err(JsonResponse::server_error(
                        "Failed to configure workspace membership",
                    )
                    .into_response());
                }
            }

            if let Err(err) = app_state
                .workspace_repo
                .add_member(workspace.id, user_id, WorkspaceRole::Owner)
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

    Ok(json!({
        "success": true,
        "plan": payload.plan_tier,
        "workspace": created_workspace,
        "memberships": memberships,
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

    let plans = plan_options();

    Json(json!({
        "success": true,
        "user": user,
        "workflows": workflows,
        "memberships": memberships,
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

async fn fetch_workspace_role(
    app_state: &AppState,
    user_id: Uuid,
    workspace_id: Uuid,
) -> Result<Option<WorkspaceRole>, Response> {
    let memberships = app_state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await
        .map_err(|_| JsonResponse::server_error("Failed to load memberships").into_response())?;
    Ok(memberships
        .into_iter()
        .find(|m| m.workspace.id == workspace_id)
        .map(|m| m.role))
}

async fn ensure_workspace_admin(
    app_state: &AppState,
    acting_user: Uuid,
    workspace_id: Uuid,
) -> Result<WorkspaceRole, Response> {
    match fetch_workspace_role(app_state, acting_user, workspace_id).await? {
        Some(role) if matches!(role, WorkspaceRole::Owner | WorkspaceRole::Admin) => Ok(role),
        _ => Err(JsonResponse::forbidden("Admin permissions required").into_response()),
    }
}

async fn ensure_workspace_owner(
    app_state: &AppState,
    acting_user: Uuid,
    workspace_id: Uuid,
) -> Result<(), Response> {
    match fetch_workspace_role(app_state, acting_user, workspace_id).await? {
        Some(WorkspaceRole::Owner) => Ok(()),
        _ => Err(JsonResponse::forbidden("Owner permissions required").into_response()),
    }
}

async fn require_workspace_admin(
    app_state: &AppState,
    acting_user: Uuid,
    workspace_id: Uuid,
) -> Result<(), Response> {
    ensure_workspace_admin(app_state, acting_user, workspace_id)
        .await
        .map(|_| ())
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
    if let Err(resp) = ensure_workspace_admin(&app_state, user_id, workspace_id).await {
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
    let acting_role = match ensure_workspace_admin(&app_state, user_id, workspace_id).await {
        Ok(role) => role,
        Err(resp) => return resp,
    };
    if payload.role == WorkspaceRole::Owner {
        if acting_role != WorkspaceRole::Owner {
            return JsonResponse::forbidden(
                "Only the current owner can initiate ownership transfers",
            )
            .into_response();
        }
        return JsonResponse::bad_request(
            "Invite members as admin, user, or viewer and transfer ownership after they join",
        )
        .into_response();
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
    let acting_role = match ensure_workspace_admin(&app_state, user_id, workspace_id).await {
        Ok(role) => role,
        Err(resp) => return resp,
    };

    let members = match app_state.workspace_repo.list_members(workspace_id).await {
        Ok(list) => list,
        Err(_) => return JsonResponse::server_error("Failed to list members").into_response(),
    };

    let current_member = match members.into_iter().find(|m| m.user_id == member_id) {
        Some(member) => member,
        None => return JsonResponse::not_found("Member not found").into_response(),
    };

    if payload.role == current_member.role {
        return Json(json!({"success": true})).into_response();
    }

    if current_member.role == WorkspaceRole::Owner && payload.role != WorkspaceRole::Owner {
        return JsonResponse::bad_request(
            "Transfer ownership to another member before changing this role",
        )
        .into_response();
    }

    if payload.role == WorkspaceRole::Owner {
        if acting_role != WorkspaceRole::Owner {
            return JsonResponse::forbidden("Only the current owner can transfer ownership")
                .into_response();
        }
        if member_id == user_id {
            return Json(json!({"success": true})).into_response();
        }

        if let Err(err) = app_state
            .workspace_repo
            .set_member_role(workspace_id, user_id, WorkspaceRole::Admin)
            .await
        {
            tracing::error!("failed to demote current owner before transfer: {:?}", err);
            return JsonResponse::server_error("Failed to transfer ownership").into_response();
        }

        match app_state
            .workspace_repo
            .set_member_role(workspace_id, member_id, WorkspaceRole::Owner)
            .await
        {
            Ok(_) => Json(json!({"success": true})).into_response(),
            Err(err) => {
                tracing::error!("failed to assign new workspace owner: {:?}", err);
                let _ = app_state
                    .workspace_repo
                    .set_member_role(workspace_id, user_id, WorkspaceRole::Owner)
                    .await;
                JsonResponse::server_error("Failed to transfer ownership").into_response()
            }
        }
    } else {
        match app_state
            .workspace_repo
            .set_member_role(workspace_id, member_id, payload.role)
            .await
        {
            Ok(_) => Json(json!({"success": true})).into_response(),
            Err(_) => JsonResponse::server_error("Failed to update role").into_response(),
        }
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
    let members = match app_state.workspace_repo.list_members(workspace_id).await {
        Ok(list) => list,
        Err(_) => return JsonResponse::server_error("Failed to list members").into_response(),
    };
    let target_member = match members.into_iter().find(|m| m.user_id == member_id) {
        Some(member) => member,
        None => return JsonResponse::not_found("Member not found").into_response(),
    };
    if target_member.role == WorkspaceRole::Owner {
        return JsonResponse::bad_request(
            "Transfer ownership to another member before removing this user",
        )
        .into_response();
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

// --- Email-based invitations ---

#[derive(Debug, Deserialize)]
pub struct CreateInvitationPayload {
    pub email: String,
    pub role: WorkspaceRole,
    #[serde(default)]
    pub expires_in_days: Option<i32>,
}

fn random_token() -> String {
    Uuid::new_v4().to_string().replace('-', "")
}

fn build_invite_signup_url(frontend_origin: &str, token: &str) -> String {
    format!("{}/signup?invite={}", frontend_origin, encode(token))
}

pub async fn create_workspace_invitation(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path(workspace_id): axum::extract::Path<Uuid>,
    Json(payload): Json<CreateInvitationPayload>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let acting_role = match ensure_workspace_admin(&app_state, user_id, workspace_id).await {
        Ok(role) => role,
        Err(resp) => return resp,
    };

    if payload.role == WorkspaceRole::Owner {
        if acting_role != WorkspaceRole::Owner {
            return JsonResponse::forbidden(
                "Only the current owner can initiate ownership transfers",
            )
            .into_response();
        }
        return JsonResponse::bad_request(
            "Invite members as admin, user, or viewer and transfer ownership after they join",
        )
        .into_response();
    }

    let email = payload.email.trim();
    if email.is_empty() {
        return JsonResponse::bad_request("Email is required").into_response();
    }
    let expires_days = payload.expires_in_days.unwrap_or(14).max(1).min(60);
    let expires_at = OffsetDateTime::now_utc() + time::Duration::days(expires_days.into());

    let token = random_token();
    let invite = match app_state
        .workspace_repo
        .create_workspace_invitation(
            workspace_id,
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
    let accept_url = build_invite_signup_url(frontend, &invite.token);
    let subject = format!("You're invited to join {} on DSentr", workspace_id);
    let body = format!(
        "You've been invited to join a workspace on DSentr.\n\nOpen this link to accept: {}\n\nThis link expires in {} days.",
        accept_url, expires_days
    );
    if let Err(err) = app_state
        .mailer
        .send_email_generic(email, &subject, &body)
        .await
    {
        tracing::warn!(?err, "failed to send invitation email");
    }

    Json(json!({"success": true, "invitation": invite})).into_response()
}

pub async fn list_workspace_invitations(
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
    match app_state
        .workspace_repo
        .list_workspace_invitations(workspace_id)
        .await
    {
        Ok(list) => Json(json!({"success": true, "invitations": list})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to list invitations").into_response(),
    }
}

pub async fn revoke_workspace_invitation(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    axum::extract::Path((workspace_id, invite_id)): axum::extract::Path<(Uuid, Uuid)>,
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
        .revoke_workspace_invitation(invite_id)
        .await
    {
        Ok(_) => Json(json!({"success": true})).into_response(),
        Err(_) => JsonResponse::server_error("Failed to revoke invitation").into_response(),
    }
}

// Public: preview invite
pub async fn preview_invitation(
    State(app_state): State<AppState>,
    axum::extract::Path(token): axum::extract::Path<String>,
) -> Response {
    match app_state
        .workspace_repo
        .find_invitation_by_token(&token)
        .await
    {
        Ok(Some(inv)) => {
            let now = OffsetDateTime::now_utc();
            let expired = inv.expires_at <= now;
            let revoked = inv.revoked_at.is_some();
            let accepted = inv.accepted_at.is_some();
            let ignored = inv.ignored_at.is_some();
            Json(json!({
                "success": true,
                "invitation": inv,
                "expired": expired,
                "revoked": revoked,
                "accepted": accepted,
                "ignored": ignored,
            }))
            .into_response()
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
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let invite = match app_state
        .workspace_repo
        .find_invitation_by_token(&token)
        .await
    {
        Ok(Some(i)) => i,
        Ok(None) => return JsonResponse::not_found("Invite not found").into_response(),
        Err(_) => return JsonResponse::server_error("Failed to load invite").into_response(),
    };
    let now = OffsetDateTime::now_utc();
    if invite.revoked_at.is_some()
        || invite.accepted_at.is_some()
        || invite.ignored_at.is_some()
        || invite.expires_at <= now
    {
        return JsonResponse::bad_request("Invitation is not valid").into_response();
    }
    // Add workspace membership
    let _ = app_state
        .workspace_repo
        .add_member(invite.workspace_id, user_id, invite.role)
        .await;
    let _ = app_state
        .workspace_repo
        .mark_invitation_accepted(invite.id)
        .await;
    Json(json!({"success": true})).into_response()
}

// Workspace -> Solo downgrade

#[derive(Debug, Deserialize)]
pub struct WorkspaceToSoloPreviewPayload {
    pub workspace_id: Uuid,
}

pub async fn workspace_to_solo_preview(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Json(payload): Json<WorkspaceToSoloPreviewPayload>,
) -> Response {
    let acting = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = ensure_workspace_owner(&app_state, acting, payload.workspace_id).await {
        return resp;
    }
    match app_state
        .workspace_repo
        .list_members(payload.workspace_id)
        .await
    {
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
pub struct WorkspaceToSoloExecutePayload {
    pub workspace_id: Uuid,
}

pub async fn workspace_to_solo_execute(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Json(payload): Json<WorkspaceToSoloExecutePayload>,
) -> Response {
    let acting = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    if let Err(resp) = ensure_workspace_owner(&app_state, acting, payload.workspace_id).await {
        return resp;
    }
    // Remove all members except acting user
    if let Ok(members) = app_state
        .workspace_repo
        .list_members(payload.workspace_id)
        .await
    {
        for m in members {
            if m.user_id == acting {
                continue;
            }
            let _ = app_state
                .workspace_repo
                .remove_member(payload.workspace_id, m.user_id)
                .await;
        }
    }
    let _ = app_state
        .db
        .update_user_plan(acting, PlanTier::Solo.as_str())
        .await;
    Json(json!({"success": true})).into_response()
}

#[cfg(test)]
mod tests {
    use super::build_invite_signup_url;

    #[test]
    fn invite_urls_target_signup_with_encoded_token() {
        let url = build_invite_signup_url("https://app.example.com", "abc+/=?");
        assert_eq!(url, "https://app.example.com/signup?invite=abc%2B%2F%3D%3F");
    }
}
