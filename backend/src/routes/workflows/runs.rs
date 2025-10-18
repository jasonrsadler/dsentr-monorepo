use super::{
    helpers::{enforce_solo_workflow_limit, plan_violation_response, SOLO_MONTHLY_RUN_LIMIT},
    prelude::*,
};

async fn fetch_workflow_for_member(
    app_state: &AppState,
    actor_id: Uuid,
    workflow_id: Uuid,
    server_error_message: &'static str,
) -> Result<Workflow, Response> {
    match app_state
        .workflow_repo
        .find_workflow_for_member(actor_id, workflow_id)
        .await
    {
        Ok(Some(workflow)) => Ok(workflow),
        Ok(None) => Err(JsonResponse::not_found("Workflow not found").into_response()),
        Err(err) => {
            eprintln!(
                "DB error fetching workflow {workflow_id} for user {actor_id}: {:?}",
                err
            );
            Err(JsonResponse::server_error(server_error_message).into_response())
        }
    }
}

#[derive(Deserialize)]
pub struct StartWorkflowRunRequest {
    pub idempotency_key: Option<String>,
    pub context: Option<serde_json::Value>,
    pub priority: Option<i32>,
}

pub async fn start_workflow_run(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    payload: Option<Json<StartWorkflowRunRequest>>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let wf =
        match fetch_workflow_for_member(&app_state, user_id, workflow_id, "Failed to start run")
            .await
        {
            Ok(workflow) => workflow,
            Err(response) => return response,
        };
    let owner_id = wf.user_id;
    let plan_tier = if wf.workspace_id.is_some() {
        NormalizedPlanTier::Workspace
    } else {
        app_state
            .resolve_plan_tier(user_id, claims.plan.as_deref())
            .await
    };

    if plan_tier.is_solo() {
        if wf.workspace_id.is_none() && wf.user_id == user_id {
            match app_state
                .workflow_repo
                .list_workflows_by_user(owner_id)
                .await
            {
                Ok(existing) => {
                    let allowed = enforce_solo_workflow_limit(&existing);
                    let allowed_ids: HashSet<_> = allowed.into_iter().map(|wf| wf.id).collect();
                    if !allowed_ids.contains(&wf.id) {
                        let violation = PlanViolation {
                            code: "workflow-limit",
                            message: "This workflow is locked on the solo plan. Upgrade in Settings → Plan to run it.".to_string(),
                            node_label: None,
                        };
                        return plan_violation_response(vec![violation]);
                    }
                }
                Err(err) => {
                    eprintln!("Failed to enforce workflow limit before run: {:?}", err);
                    return JsonResponse::server_error("Failed to start run").into_response();
                }
            }

            let assessment = assess_workflow_for_plan(&wf.data);
            if !assessment.violations.is_empty() {
                return plan_violation_response(assessment.violations);
            }
        }

        let now = OffsetDateTime::now_utc();
        let start_of_month = now
            .replace_day(1)
            .unwrap_or(now)
            .replace_time(Time::MIDNIGHT);
        match app_state
            .workflow_repo
            .count_user_runs_since(owner_id, start_of_month)
            .await
        {
            Ok(count) if count >= SOLO_MONTHLY_RUN_LIMIT => {
                let violation = PlanViolation {
                    code: "run-limit",
                    message: "Solo plan usage includes 250 runs per month. You've reached the limit—upgrade in Settings → Plan to keep running workflows.".to_string(),
                    node_label: None,
                };
                return plan_violation_response(vec![violation]);
            }
            Ok(_) => {}
            Err(err) => {
                eprintln!("Failed to check monthly usage: {:?}", err);
                return JsonResponse::server_error("Failed to start run").into_response();
            }
        }
    }

    // Extract once to avoid borrow/move conflict
    let (idempotency_key_owned, trigger_ctx, priority) = match payload {
        Some(Json(req)) => (req.idempotency_key, req.context, req.priority),
        None => (None, None, None),
    };
    let idempotency_key = idempotency_key_owned.as_deref();

    // Snapshot the graph (immutable)
    let mut snapshot = wf.data.clone();
    if let Some(ctx) = trigger_ctx {
        snapshot["_trigger_context"] = ctx;
    }
    // Attach per-workflow egress allowlist for engine
    snapshot["_egress_allowlist"] = serde_json::Value::Array(
        wf.egress_allowlist
            .iter()
            .cloned()
            .map(serde_json::Value::String)
            .collect(),
    );

    match app_state
        .workflow_repo
        .create_workflow_run(owner_id, workflow_id, snapshot, idempotency_key)
        .await
    {
        Ok(run) => {
            if let Some(p) = priority {
                let _ = app_state
                    .workflow_repo
                    .set_run_priority(owner_id, workflow_id, run.id, p)
                    .await;
            }
            (
                StatusCode::ACCEPTED,
                Json(json!({
                    "success": true,
                    "run": run
                })),
            )
                .into_response()
        }
        Err(e) => {
            eprintln!("DB error creating workflow run: {:?}", e);
            JsonResponse::server_error("Failed to enqueue run").into_response()
        }
    }
}

pub async fn get_workflow_run_status(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((workflow_id, run_id)): Path<(Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let workflow =
        match fetch_workflow_for_member(&app_state, user_id, workflow_id, "Failed to fetch run")
            .await
        {
            Ok(workflow) => workflow,
            Err(response) => return response,
        };
    let owner_id = workflow.user_id;

    match app_state
        .workflow_repo
        .get_workflow_run(owner_id, workflow_id, run_id)
        .await
    {
        Ok(Some(run)) => {
            let nodes_res = app_state
                .workflow_repo
                .list_workflow_node_runs(owner_id, workflow_id, run_id)
                .await;
            match nodes_res {
                Ok(node_runs) => (
                    StatusCode::OK,
                    Json(json!({
                        "success": true,
                        "run": run,
                        "node_runs": node_runs
                    })),
                )
                    .into_response(),
                Err(e) => {
                    eprintln!("DB error listing node runs: {:?}", e);
                    JsonResponse::server_error("Failed to fetch run status").into_response()
                }
            }
        }
        Ok(None) => JsonResponse::not_found("Run not found").into_response(),
        Err(e) => {
            eprintln!("DB error fetching run: {:?}", e);
            JsonResponse::server_error("Failed to fetch run").into_response()
        }
    }
}

pub async fn cancel_workflow_run(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((workflow_id, run_id)): Path<(Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let workflow =
        match fetch_workflow_for_member(&app_state, user_id, workflow_id, "Failed to cancel run")
            .await
        {
            Ok(workflow) => workflow,
            Err(response) => return response,
        };
    let owner_id = workflow.user_id;

    match app_state
        .workflow_repo
        .cancel_workflow_run(owner_id, workflow_id, run_id)
        .await
    {
        Ok(true) => (
            StatusCode::OK,
            Json(json!({"success": true, "status": "canceled" })),
        )
            .into_response(),
        Ok(false) => {
            JsonResponse::bad_request("Run is not cancelable or not found").into_response()
        }
        Err(e) => {
            eprintln!("DB error canceling run: {:?}", e);
            JsonResponse::server_error("Failed to cancel run").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct ListRunsQuery {
    pub workflow_id: Option<Uuid>,
}

pub async fn list_active_runs(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Query(params): Query<ListRunsQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let (owner_id, workflow_scope) = if let Some(workflow_id) = params.workflow_id {
        match fetch_workflow_for_member(&app_state, user_id, workflow_id, "Failed to list runs")
            .await
        {
            Ok(workflow) => (workflow.user_id, Some(workflow_id)),
            Err(response) => return response,
        }
    } else {
        (user_id, None)
    };

    match app_state
        .workflow_repo
        .list_active_runs(owner_id, workflow_scope)
        .await
    {
        Ok(runs) => (
            StatusCode::OK,
            Json(json!({ "success": true, "runs": runs })),
        )
            .into_response(),
        Err(e) => {
            eprintln!("DB error listing active runs: {:?}", e);
            JsonResponse::server_error("Failed to list runs").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct PagedRunsQuery {
    pub status: Option<Vec<String>>, // e.g., status=running&status=queued
    pub page: Option<i64>,           // 1-based
    pub per_page: Option<i64>,       // default 20
}

pub async fn list_runs_for_workflow(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Query(params): Query<PagedRunsQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let per_page = params.per_page.unwrap_or(20).clamp(1, 100);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * per_page;

    let workflow =
        match fetch_workflow_for_member(&app_state, user_id, workflow_id, "Failed to list runs")
            .await
        {
            Ok(workflow) => workflow,
            Err(response) => return response,
        };

    match app_state
        .workflow_repo
        .list_runs_paged(
            workflow.user_id,
            Some(workflow_id),
            params.status.as_deref(),
            per_page,
            offset,
        )
        .await
    {
        Ok(runs) => (
            StatusCode::OK,
            Json(json!({ "success": true, "runs": runs, "page": page, "per_page": per_page })),
        )
            .into_response(),
        Err(e) => {
            eprintln!("DB error listing runs: {:?}", e);
            JsonResponse::server_error("Failed to list runs").into_response()
        }
    }
}

pub async fn cancel_all_runs_for_workflow(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let workflow =
        match fetch_workflow_for_member(&app_state, user_id, workflow_id, "Failed to cancel runs")
            .await
        {
            Ok(workflow) => workflow,
            Err(response) => return response,
        };

    match app_state
        .workflow_repo
        .cancel_all_runs_for_workflow(workflow.user_id, workflow_id)
        .await
    {
        Ok(affected) => (
            StatusCode::OK,
            Json(json!({"success": true, "canceled": affected })),
        )
            .into_response(),
        Err(e) => {
            eprintln!("DB error canceling runs: {:?}", e);
            JsonResponse::server_error("Failed to cancel runs").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct RerunRequest {
    pub idempotency_key: Option<String>,
    pub context: Option<serde_json::Value>,
    pub start_from_node_id: Option<String>,
}

pub async fn rerun_workflow_run(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((workflow_id, run_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<RerunRequest>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    // Fetch the original run to get snapshot
    let workflow = match fetch_workflow_for_member(
        &app_state,
        user_id,
        workflow_id,
        "Failed to rerun",
    )
    .await
    {
        Ok(workflow) => workflow,
        Err(response) => return response,
    };

    let base_run = match app_state
        .workflow_repo
        .get_workflow_run(workflow.user_id, workflow_id, run_id)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => return JsonResponse::not_found("Run not found").into_response(),
        Err(e) => {
            eprintln!("DB error fetching run for rerun: {:?}", e);
            return JsonResponse::server_error("Failed to rerun").into_response();
        }
    };

    let mut snapshot = base_run.snapshot.clone();
    if let Some(ctx) = payload.context {
        snapshot["_trigger_context"] = ctx;
    }
    if let Some(start_id) = payload.start_from_node_id {
        snapshot["_start_from_node"] = serde_json::Value::String(start_id);
    }

    match app_state
        .workflow_repo
        .create_workflow_run(
            workflow.user_id,
            workflow_id,
            snapshot,
            payload.idempotency_key.as_deref(),
        )
        .await
    {
        Ok(run) => (
            StatusCode::ACCEPTED,
            Json(json!({"success": true, "run": run})),
        )
            .into_response(),
        Err(e) => {
            eprintln!("DB error creating rerun: {:?}", e);
            JsonResponse::server_error("Failed to enqueue rerun").into_response()
        }
    }
}

pub async fn rerun_from_failed_node(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((workflow_id, run_id)): Path<(Uuid, Uuid)>,
    Json(mut payload): Json<RerunRequest>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let workflow = match fetch_workflow_for_member(
        &app_state,
        user_id,
        workflow_id,
        "Failed to rerun",
    )
    .await
    {
        Ok(workflow) => workflow,
        Err(response) => return response,
    };

    let nodes = match app_state
        .workflow_repo
        .list_workflow_node_runs(workflow.user_id, workflow_id, run_id)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            eprintln!("DB error fetching node runs: {:?}", e);
            return JsonResponse::server_error("Failed to rerun").into_response();
        }
    };
    let failed = nodes
        .iter()
        .rev()
        .find(|n| n.status == "failed")
        .and_then(|n| Some(n.node_id.clone()));
    if let Some(node_id) = failed {
        payload.start_from_node_id = Some(node_id);
        rerun_workflow_run(
            State(app_state),
            AuthSession(claims),
            Path((workflow_id, run_id)),
            Json(payload),
        )
        .await
    } else {
        JsonResponse::bad_request("No failed node found for this run").into_response()
    }
}

// Download run JSON (run + node_runs)
pub async fn download_run_json(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((workflow_id, run_id)): Path<(Uuid, Uuid)>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let workflow =
        match fetch_workflow_for_member(&app_state, user_id, workflow_id, "Failed to download run")
            .await
        {
            Ok(workflow) => workflow,
            Err(response) => return response,
        };

    let run_opt = app_state
        .workflow_repo
        .get_workflow_run(workflow.user_id, workflow_id, run_id)
        .await;

    match run_opt {
        Ok(Some(run)) => {
            let nodes_res = app_state
                .workflow_repo
                .list_workflow_node_runs(workflow.user_id, workflow_id, run_id)
                .await;
            match nodes_res {
                Ok(node_runs) => {
                    let payload = json!({"run": run, "node_runs": node_runs});
                    let body = axum::Json(payload);
                    let mut resp = body.into_response();
                    resp.headers_mut().insert(
                        axum::http::header::CONTENT_DISPOSITION,
                        axum::http::HeaderValue::from_static("attachment; filename=run.json"),
                    );
                    resp
                }
                Err(e) => {
                    eprintln!("DB error listing node runs: {:?}", e);
                    JsonResponse::server_error("Failed to download run").into_response()
                }
            }
        }
        Ok(None) => JsonResponse::not_found("Run not found").into_response(),
        Err(e) => {
            eprintln!("DB error fetching run: {:?}", e);
            JsonResponse::server_error("Failed to download run").into_response()
        }
    }
}
