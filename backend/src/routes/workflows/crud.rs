use super::{
    helpers::{
        diff_user_nodes_only, enforce_solo_workflow_limit, is_unique_violation,
        plan_violation_response, sync_workflow_schedule,
    },
    prelude::*,
};

async fn membership_role_for(
    state: &AppState,
    user_id: Uuid,
    workspace_id: Uuid,
) -> Result<Option<WorkspaceRole>, sqlx::Error> {
    let memberships = state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await?;

    Ok(memberships
        .into_iter()
        .find(|membership| membership.workspace.id == workspace_id)
        .map(|membership| membership.role))
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
    let plan_tier = app_state
        .resolve_plan_tier(user_id, claims.plan.as_deref())
        .await;

    if plan_tier.is_solo() {
        let assessment = assess_workflow_for_plan(&data);
        if !assessment.violations.is_empty() {
            return plan_violation_response(assessment.violations);
        }

        match app_state
            .workflow_repo
            .list_workflows_by_user(user_id)
            .await
        {
            Ok(existing) if existing.len() >= 3 => {
                let violation = PlanViolation {
                    code: "workflow-limit",
                    message: "Solo accounts can save up to 3 workflows. Delete an existing workflow or upgrade in Settings → Plan.".to_string(),
                    node_label: None,
                };
                return plan_violation_response(vec![violation]);
            }
            Ok(_) => {}
            Err(err) => {
                eprintln!("Failed to check workflow count: {:?}", err);
                return JsonResponse::server_error("Failed to create workflow").into_response();
            }
        }
    }

    if let Some(workspace_id) = workspace_id {
        match membership_role_for(&app_state, user_id, workspace_id).await {
            Ok(Some(role)) => {
                if matches!(role, WorkspaceRole::Viewer) {
                    return JsonResponse::forbidden("Workspace viewers cannot create workflows.")
                        .into_response();
                }
            }
            Ok(None) => {
                return JsonResponse::forbidden("You do not have access to this workspace.")
                    .into_response();
            }
            Err(err) => {
                eprintln!("Failed to verify workspace membership: {:?}", err);
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

    let workspace_ids: Vec<Uuid> = match app_state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await
    {
        Ok(memberships) => memberships
            .into_iter()
            .map(|membership| membership.workspace.id)
            .collect(),
        Err(err) => {
            eprintln!("Failed to load workspace memberships: {:?}", err);
            return JsonResponse::server_error("Failed to fetch workflows").into_response();
        }
    };

    let mut combined: HashMap<Uuid, Workflow> =
        owned_workflows.into_iter().map(|wf| (wf.id, wf)).collect();

    if !workspace_ids.is_empty() {
        let mut ids: Vec<Uuid> = workspace_ids.into_iter().collect();
        ids.sort_unstable();
        ids.dedup();

        match app_state
            .workflow_repo
            .list_workflows_by_workspace_ids(&ids)
            .await
        {
            Ok(workflows) => {
                for workflow in workflows {
                    combined.entry(workflow.id).or_insert(workflow);
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
        hidden_count = owned.len().saturating_sub(allowed_owned.len());
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
            if plan_tier.is_solo() && workflow.user_id == user_id {
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

    if plan_tier.is_solo() {
        let assessment = assess_workflow_for_plan(&data);
        if !assessment.violations.is_empty() {
            return plan_violation_response(assessment.violations);
        }
    }

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

    let workspace_role = if let Some(workspace_id) = existing.workspace_id {
        match membership_role_for(&app_state, user_id, workspace_id).await {
            Ok(role) => role,
            Err(err) => {
                eprintln!("Failed to verify workspace membership: {:?}", err);
                return JsonResponse::server_error("Failed to update workflow").into_response();
            }
        }
    } else {
        None
    };

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
    let allowed_ids = if plan_tier.is_solo() && is_creator {
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
                .insert_workflow_log(owner_id, workflow.id, diffs)
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

    if workflow.locked_by.is_none() {
        return Json(json!({ "success": true, "workflow": workflow })).into_response();
    }

    let workspace_role = if let Some(workspace_id) = workflow.workspace_id {
        match membership_role_for(&app_state, user_id, workspace_id).await {
            Ok(role) => role,
            Err(err) => {
                eprintln!("Failed to verify workspace membership: {:?}", err);
                return JsonResponse::server_error("Failed to unlock workflow").into_response();
            }
        }
    } else {
        None
    };

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
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    match app_state
        .workflow_repo
        .delete_workflow(user_id, workflow_id)
        .await
    {
        Ok(true) => Json(json!({ "success": true })).into_response(),
        Ok(false) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error deleting workflow: {:?}", e);
            JsonResponse::server_error("Failed to delete workflow").into_response()
        }
    }
}
