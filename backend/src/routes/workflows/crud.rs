use super::{
    helpers::{
        can_access_workflow_in_context, can_access_workspace_in_context, diff_user_nodes_only,
        enforce_solo_workflow_limit, is_unique_violation, membership_roles_map,
        plan_context_for_user, plan_violation_response, sync_workflow_schedule, PlanContext,
    },
    prelude::*,
};
use crate::utils::change_history::log_workspace_history_event;

#[derive(Default, Deserialize)]
pub struct WorkflowContextQuery {
    #[serde(default)]
    workspace: Option<Uuid>,
}

pub async fn create_workflow(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Json(payload): Json<CreateWorkflow>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let CreateWorkflow {
        name,
        description,
        data,
        workspace_id,
    } = payload;
    let mut workspace_id = workspace_id;
    let plan_tier = app_state
        .resolve_plan_tier(user_id, claims.plan.as_deref())
        .await;

    let memberships = match app_state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await
    {
        Ok(memberships) => memberships,
        Err(err) => {
            eprintln!("Failed to load workspace memberships: {:?}", err);
            return JsonResponse::server_error("Failed to create workflow").into_response();
        }
    };
    let roles_map = membership_roles_map(&memberships);
    let context = plan_context_for_user(claims.plan.as_deref(), &memberships, workspace_id);

    if plan_tier.is_solo() && matches!(context, PlanContext::Solo) {
        let assessment = assess_workflow_for_plan(&data);
        if !assessment.violations.is_empty() {
            return plan_violation_response(assessment.violations);
        }
    }

    if workspace_id.is_none() {
        workspace_id = match context {
            PlanContext::WorkspaceOwned { workspace_id }
            | PlanContext::WorkspaceMember { workspace_id } => Some(workspace_id),
            PlanContext::Solo | PlanContext::WorkspaceUnknown => None,
        };
    }

    if let Some(workspace_id) = workspace_id {
        match roles_map.get(&workspace_id).copied() {
            Some(role) => {
                if matches!(role, WorkspaceRole::Viewer) {
                    return JsonResponse::forbidden("Workspace viewers cannot create workflows.")
                        .into_response();
                }
            }
            None => {
                return JsonResponse::forbidden("You do not have access to this workspace.")
                    .into_response();
            }
        }
    }

    if plan_tier.is_solo() && workspace_id.is_none() {
        match app_state
            .workflow_repo
            .list_workflows_by_user(user_id)
            .await
        {
            Ok(existing) => {
                let personal_count = existing
                    .iter()
                    .filter(|wf| wf.workspace_id.is_none())
                    .count();
                if personal_count >= 3 {
                    let violation = PlanViolation {
                        code: "workflow-limit",
                        message: "Solo accounts can save up to 3 workflows. Delete an existing workflow or upgrade in Settings → Plan.".to_string(),
                        node_label: None,
                    };
                    return plan_violation_response(vec![violation]);
                }
            }
            Err(err) => {
                eprintln!("Failed to check workflow count: {:?}", err);
                return JsonResponse::server_error("Failed to create workflow").into_response();
            }
        }
    }

    let result = app_state
        .workflow_repo
        .create_workflow(user_id, workspace_id, &name, description.as_deref(), data)
        .await;

    match result {
        Ok(workflow) => {
            sync_workflow_schedule(&app_state, &workflow).await;
            sync_secrets_from_workflow(&app_state, user_id, &workflow.data).await;
            (
                StatusCode::CREATED,
                Json(json!({
                    "success": true,
                    "workflow": workflow
                })),
            )
                .into_response()
        }
        Err(e) => {
            eprintln!("DB error creating workflow: {:?}", e);
            if is_unique_violation(&e) {
                JsonResponse::conflict("A workflow with this name already exists").into_response()
            } else {
                JsonResponse::server_error("Failed to create workflow").into_response()
            }
        }
    }
}

pub async fn list_workflows(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Query(params): Query<WorkflowContextQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let plan_tier = app_state
        .resolve_plan_tier(user_id, claims.plan.as_deref())
        .await;

    let owned_workflows = match app_state
        .workflow_repo
        .list_workflows_by_user(user_id)
        .await
    {
        Ok(workflows) => workflows,
        Err(e) => {
            eprintln!("DB error listing user workflows: {:?}", e);
            return JsonResponse::server_error("Failed to fetch workflows").into_response();
        }
    };

    let memberships = match app_state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await
    {
        Ok(memberships) => memberships,
        Err(err) => {
            eprintln!("Failed to load workspace memberships: {:?}", err);
            return JsonResponse::server_error("Failed to fetch workflows").into_response();
        }
    };

    let roles_map = membership_roles_map(&memberships);
    let context = plan_context_for_user(claims.plan.as_deref(), &memberships, params.workspace);

    if params.workspace.is_some()
        && !matches!(
            context,
            PlanContext::WorkspaceOwned { .. } | PlanContext::WorkspaceMember { .. }
        )
    {
        return JsonResponse::forbidden("You do not have access to this workspace.")
            .into_response();
    }

    let mut combined: HashMap<Uuid, Workflow> = HashMap::new();
    for workflow in owned_workflows {
        if can_access_workflow_in_context(&workflow, context, &roles_map) {
            combined.insert(workflow.id, workflow);
        }
    }

    let mut workspace_ids: Vec<Uuid> = memberships
        .iter()
        .map(|membership| membership.workspace.id)
        .filter(|workspace_id| can_access_workspace_in_context(context, *workspace_id, &roles_map))
        .collect();
    workspace_ids.sort_unstable();
    workspace_ids.dedup();

    if !workspace_ids.is_empty() {
        match app_state
            .workflow_repo
            .list_workflows_by_workspace_ids(&workspace_ids)
            .await
        {
            Ok(workflows) => {
                for workflow in workflows {
                    if can_access_workflow_in_context(&workflow, context, &roles_map) {
                        combined.entry(workflow.id).or_insert(workflow);
                    }
                }
            }
            Err(err) => {
                eprintln!("DB error listing workspace workflows: {:?}", err);
                return JsonResponse::server_error("Failed to fetch workflows").into_response();
            }
        }
    }

    let mut workflows: Vec<Workflow> = combined.into_values().collect();
    workflows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    let mut hidden_count = 0usize;
    let visible = if plan_tier.is_solo() {
        let owned: Vec<_> = workflows
            .iter()
            .filter(|wf| wf.user_id == user_id)
            .cloned()
            .collect();
        let allowed_owned = enforce_solo_workflow_limit(&owned);
        let allowed_ids: HashSet<_> = allowed_owned.iter().map(|wf| wf.id).collect();
        let personal_total = owned.iter().filter(|wf| wf.workspace_id.is_none()).count();
        hidden_count = personal_total.saturating_sub(allowed_owned.len());
        workflows
            .into_iter()
            .filter(|wf| wf.workspace_id.is_some() || allowed_ids.contains(&wf.id))
            .collect()
    } else {
        workflows
    };

    let mut payload = json!({
        "success": true,
        "workflows": visible,
    });
    if plan_tier.is_solo() {
        payload["hidden_count"] = json!(hidden_count);
    }
    (StatusCode::OK, Json(payload)).into_response()
}

pub async fn get_workflow(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Query(params): Query<WorkflowContextQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let plan_tier = app_state
        .resolve_plan_tier(user_id, claims.plan.as_deref())
        .await;

    match app_state
        .workflow_repo
        .find_workflow_for_member(user_id, workflow_id)
        .await
    {
        Ok(Some(workflow)) => {
            let memberships = match app_state
                .workspace_repo
                .list_memberships_for_user(user_id)
                .await
            {
                Ok(memberships) => memberships,
                Err(err) => {
                    eprintln!("Failed to load workspace memberships: {:?}", err);
                    return JsonResponse::server_error("Failed to fetch workflow").into_response();
                }
            };
            let roles_map = membership_roles_map(&memberships);
            let context =
                plan_context_for_user(claims.plan.as_deref(), &memberships, params.workspace);

            if params.workspace.is_some()
                && !matches!(
                    context,
                    PlanContext::WorkspaceOwned { .. } | PlanContext::WorkspaceMember { .. }
                )
            {
                return JsonResponse::forbidden("You do not have access to this workspace.")
                    .into_response();
            }

            if !can_access_workflow_in_context(&workflow, context, &roles_map) {
                return JsonResponse::forbidden(
                    "This workflow is not available in the current plan context.",
                )
                .into_response();
            }

            if plan_tier.is_solo() && workflow.user_id == user_id && workflow.workspace_id.is_none()
            {
                match app_state
                    .workflow_repo
                    .list_workflows_by_user(user_id)
                    .await
                {
                    Ok(existing) => {
                        let allowed = enforce_solo_workflow_limit(&existing);
                        let allowed_ids: HashSet<_> = allowed.into_iter().map(|wf| wf.id).collect();
                        if !allowed_ids.contains(&workflow.id) {
                            let violation = PlanViolation {
                                code: "workflow-limit",
                                message: "This workflow is locked on the solo plan. Upgrade in Settings → Plan to edit or run it.".to_string(),
                                node_label: None,
                            };
                            return plan_violation_response(vec![violation]);
                        }
                    }
                    Err(err) => {
                        eprintln!("Failed to enforce workflow limit: {:?}", err);
                        return JsonResponse::server_error("Failed to fetch workflow")
                            .into_response();
                    }
                }
            }
            (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "workflow": workflow
                })),
            )
                .into_response()
        }
        Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error fetching workflow: {:?}", e);
            JsonResponse::server_error("Failed to fetch workflow").into_response()
        }
    }
}

pub async fn update_workflow(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Query(params): Query<WorkflowContextQuery>,
    Json(payload): Json<CreateWorkflow>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let CreateWorkflow {
        name,
        description,
        data,
        workspace_id: _,
    } = payload;
    let plan_tier = app_state
        .resolve_plan_tier(user_id, claims.plan.as_deref())
        .await;

    let existing = match app_state
        .workflow_repo
        .find_workflow_for_member(user_id, workflow_id)
        .await
    {
        Ok(Some(workflow)) => workflow,
        Ok(None) => return JsonResponse::not_found("Workflow not found").into_response(),
        Err(err) => {
            eprintln!("Failed to load workflow for update: {:?}", err);
            return JsonResponse::server_error("Failed to update workflow").into_response();
        }
    };

    let memberships = match app_state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await
    {
        Ok(memberships) => memberships,
        Err(err) => {
            eprintln!("Failed to load workspace memberships: {:?}", err);
            return JsonResponse::server_error("Failed to update workflow").into_response();
        }
    };
    let roles_map = membership_roles_map(&memberships);
    let context = plan_context_for_user(claims.plan.as_deref(), &memberships, params.workspace);

    if params.workspace.is_some()
        && !matches!(
            context,
            PlanContext::WorkspaceOwned { .. } | PlanContext::WorkspaceMember { .. }
        )
    {
        return JsonResponse::forbidden("You do not have access to this workspace.")
            .into_response();
    }

    if !can_access_workflow_in_context(&existing, context, &roles_map) {
        return JsonResponse::forbidden(
            "This workflow is not available in the current plan context.",
        )
        .into_response();
    }

    if plan_tier.is_solo() && matches!(context, PlanContext::Solo) {
        let assessment = assess_workflow_for_plan(&data);
        if !assessment.violations.is_empty() {
            return plan_violation_response(assessment.violations);
        }
    }

    let workspace_role = existing
        .workspace_id
        .and_then(|workspace_id| roles_map.get(&workspace_id).copied());

    if matches!(workspace_role, Some(WorkspaceRole::Viewer)) {
        return JsonResponse::forbidden("Workspace viewers cannot modify workflows.")
            .into_response();
    }

    let is_workspace_admin = matches!(
        workspace_role,
        Some(WorkspaceRole::Admin | WorkspaceRole::Owner)
    );
    if let Some(locker) = existing.locked_by {
        if locker != user_id && !is_workspace_admin {
            return JsonResponse::forbidden(
                "This workflow is locked and can only be modified by the creator or an admin.",
            )
            .into_response();
        }
    }

    let is_creator = existing.user_id == user_id;
    let is_personal = existing.workspace_id.is_none();
    let allowed_ids = if plan_tier.is_solo() && is_creator && is_personal {
        match app_state
            .workflow_repo
            .list_workflows_by_user(existing.user_id)
            .await
        {
            Ok(existing_workflows) => {
                let allowed = enforce_solo_workflow_limit(&existing_workflows);
                Some(allowed.into_iter().map(|wf| wf.id).collect::<HashSet<_>>())
            }
            Err(err) => {
                eprintln!("Failed to enforce workflow limit: {:?}", err);
                return JsonResponse::server_error("Failed to update workflow").into_response();
            }
        }
    } else {
        None
    };

    let owner_id = existing.user_id;
    let before = existing.clone();

    match app_state
        .workflow_repo
        .update_workflow(owner_id, workflow_id, &name, description.as_deref(), data)
        .await
    {
        Ok(Some(workflow)) => {
            if let Some(ids) = allowed_ids.as_ref() {
                if !ids.contains(&workflow.id) {
                    let violation = PlanViolation {
                        code: "workflow-limit",
                        message: "This workflow is locked on the solo plan. Upgrade in Settings → Plan to edit or run it.".to_string(),
                        node_label: None,
                    };
                    return plan_violation_response(vec![violation]);
                }
            }
            sync_workflow_schedule(&app_state, &workflow).await;
            let diffs = diff_user_nodes_only(&before.data, &workflow.data);
            if let Err(e) = app_state
                .workflow_repo
                .insert_workflow_log(user_id, workflow.id, diffs)
                .await
            {
                eprintln!("Failed to insert workflow log: {:?}", e);
            }
            sync_secrets_from_workflow(&app_state, user_id, &workflow.data).await;
            (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "workflow": workflow
                })),
            )
                .into_response()
        }
        Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error updating workflow: {:?}", e);
            if is_unique_violation(&e) {
                JsonResponse::conflict("A workflow with this name already exists").into_response()
            } else {
                JsonResponse::server_error("Failed to update workflow").into_response()
            }
        }
    }
}

pub async fn lock_workflow(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Query(params): Query<WorkflowContextQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let workflow = match app_state
        .workflow_repo
        .find_workflow_for_member(user_id, workflow_id)
        .await
    {
        Ok(Some(workflow)) => workflow,
        Ok(None) => return JsonResponse::not_found("Workflow not found").into_response(),
        Err(err) => {
            eprintln!("Failed to load workflow for locking: {:?}", err);
            return JsonResponse::server_error("Failed to lock workflow").into_response();
        }
    };

    let memberships = match app_state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await
    {
        Ok(memberships) => memberships,
        Err(err) => {
            eprintln!("Failed to load workspace memberships: {:?}", err);
            return JsonResponse::server_error("Failed to lock workflow").into_response();
        }
    };
    let roles_map = membership_roles_map(&memberships);
    let context = plan_context_for_user(claims.plan.as_deref(), &memberships, params.workspace);

    if params.workspace.is_some()
        && !matches!(
            context,
            PlanContext::WorkspaceOwned { .. } | PlanContext::WorkspaceMember { .. }
        )
    {
        return JsonResponse::forbidden("You do not have access to this workspace.")
            .into_response();
    }

    if !can_access_workflow_in_context(&workflow, context, &roles_map) {
        return JsonResponse::forbidden(
            "This workflow is not available in the current plan context.",
        )
        .into_response();
    }

    if workflow.user_id != user_id {
        return JsonResponse::forbidden("Only the creator can lock this workflow.").into_response();
    }

    match app_state
        .workflow_repo
        .set_workflow_lock(workflow_id, Some(user_id))
        .await
    {
        Ok(Some(updated)) => (
            StatusCode::OK,
            Json(json!({ "success": true, "workflow": updated })),
        )
            .into_response(),
        Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(err) => {
            eprintln!("Failed to lock workflow: {:?}", err);
            JsonResponse::server_error("Failed to lock workflow").into_response()
        }
    }
}

pub async fn unlock_workflow(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Query(params): Query<WorkflowContextQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let workflow = match app_state
        .workflow_repo
        .find_workflow_for_member(user_id, workflow_id)
        .await
    {
        Ok(Some(workflow)) => workflow,
        Ok(None) => return JsonResponse::not_found("Workflow not found").into_response(),
        Err(err) => {
            eprintln!("Failed to load workflow for unlocking: {:?}", err);
            return JsonResponse::server_error("Failed to unlock workflow").into_response();
        }
    };

    let memberships = match app_state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await
    {
        Ok(memberships) => memberships,
        Err(err) => {
            eprintln!("Failed to load workspace memberships: {:?}", err);
            return JsonResponse::server_error("Failed to unlock workflow").into_response();
        }
    };
    let roles_map = membership_roles_map(&memberships);
    let context = plan_context_for_user(claims.plan.as_deref(), &memberships, params.workspace);

    if params.workspace.is_some()
        && !matches!(
            context,
            PlanContext::WorkspaceOwned { .. } | PlanContext::WorkspaceMember { .. }
        )
    {
        return JsonResponse::forbidden("You do not have access to this workspace.")
            .into_response();
    }

    if !can_access_workflow_in_context(&workflow, context, &roles_map) {
        return JsonResponse::forbidden(
            "This workflow is not available in the current plan context.",
        )
        .into_response();
    }

    if workflow.locked_by.is_none() {
        return Json(json!({ "success": true, "workflow": workflow })).into_response();
    }

    let workspace_role = workflow
        .workspace_id
        .and_then(|workspace_id| roles_map.get(&workspace_id).copied());

    let is_workspace_admin = matches!(
        workspace_role,
        Some(WorkspaceRole::Admin | WorkspaceRole::Owner)
    );

    if workflow.user_id != user_id && !is_workspace_admin {
        return JsonResponse::forbidden("Only the creator or an admin can unlock this workflow.")
            .into_response();
    }

    match app_state
        .workflow_repo
        .set_workflow_lock(workflow_id, None)
        .await
    {
        Ok(Some(updated)) => (
            StatusCode::OK,
            Json(json!({ "success": true, "workflow": updated })),
        )
            .into_response(),
        Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(err) => {
            eprintln!("Failed to unlock workflow: {:?}", err);
            JsonResponse::server_error("Failed to unlock workflow").into_response()
        }
    }
}

pub async fn delete_workflow(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Query(params): Query<WorkflowContextQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let workflow = match app_state
        .workflow_repo
        .find_workflow_for_member(user_id, workflow_id)
        .await
    {
        Ok(Some(workflow)) => workflow,
        Ok(None) => return JsonResponse::not_found("Workflow not found").into_response(),
        Err(err) => {
            eprintln!("Failed to load workflow for deletion: {:?}", err);
            return JsonResponse::server_error("Failed to delete workflow").into_response();
        }
    };

    let memberships = match app_state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await
    {
        Ok(memberships) => memberships,
        Err(err) => {
            eprintln!("Failed to load workspace memberships: {:?}", err);
            return JsonResponse::server_error("Failed to delete workflow").into_response();
        }
    };
    let roles_map = membership_roles_map(&memberships);
    let context = plan_context_for_user(claims.plan.as_deref(), &memberships, params.workspace);

    if params.workspace.is_some()
        && !matches!(
            context,
            PlanContext::WorkspaceOwned { .. } | PlanContext::WorkspaceMember { .. }
        )
    {
        return JsonResponse::forbidden("You do not have access to this workspace.")
            .into_response();
    }

    if !can_access_workflow_in_context(&workflow, context, &roles_map) {
        return JsonResponse::forbidden(
            "This workflow is not available in the current plan context.",
        )
        .into_response();
    }

    match app_state
        .workflow_repo
        .delete_workflow(user_id, workflow_id)
        .await
    {
        Ok(true) => {
            if let Some(workspace_id) = workflow.workspace_id {
                let event = vec![json!({
                    "path": "workflow.deleted",
                    "from": workflow.name,
                    "to": workflow.id,
                })];
                log_workspace_history_event(&app_state, workspace_id, user_id, event).await;
            }
            Json(json!({ "success": true })).into_response()
        }
        Ok(false) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error deleting workflow: {:?}", e);
            JsonResponse::server_error("Failed to delete workflow").into_response()
        }
    }
}
