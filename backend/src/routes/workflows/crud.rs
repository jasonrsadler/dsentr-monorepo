use super::{
    helpers::{
        diff_user_nodes_only, enforce_solo_workflow_limit, is_unique_violation,
        plan_violation_response, sync_workflow_schedule,
    },
    prelude::*,
};

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

    match app_state
        .workflow_repo
        .list_workflows_by_user(user_id)
        .await
    {
        Ok(workflows) => {
            let (visible, hidden_count) = if plan_tier.is_solo() {
                let limited = enforce_solo_workflow_limit(&workflows);
                let hidden = workflows.len().saturating_sub(limited.len());
                (limited, hidden)
            } else {
                (workflows, 0)
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
        Err(e) => {
            eprintln!("DB error listing workflows: {:?}", e);
            JsonResponse::server_error("Failed to fetch workflows").into_response()
        }
    }
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
        .find_workflow_by_id(user_id, workflow_id)
        .await
    {
        Ok(Some(workflow)) => {
            if plan_tier.is_solo() {
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

    let allowed_ids = if plan_tier.is_solo() {
        match app_state
            .workflow_repo
            .list_workflows_by_user(user_id)
            .await
        {
            Ok(existing) => {
                let allowed = enforce_solo_workflow_limit(&existing);
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

    let before = app_state
        .workflow_repo
        .find_workflow_by_id(user_id, workflow_id)
        .await;

    match app_state
        .workflow_repo
        .update_workflow(user_id, workflow_id, &name, description.as_deref(), data)
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
            if let Ok(Some(before_wf)) = before {
                let diffs = diff_user_nodes_only(&before_wf.data, &workflow.data);
                if let Err(e) = app_state
                    .workflow_repo
                    .insert_workflow_log(user_id, workflow.id, diffs)
                    .await
                {
                    eprintln!("Failed to insert workflow log: {:?}", e);
                }
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
