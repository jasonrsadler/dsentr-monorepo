use super::{helpers::plan_violation_response, prelude::*};

#[derive(Deserialize)]
pub struct ConcurrencyLimitBody {
    pub limit: i32,
}

pub async fn set_concurrency_limit(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Json(body): Json<ConcurrencyLimitBody>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let wf = match app_state
        .workflow_repo
        .find_workflow_for_member(user_id, workflow_id)
        .await
    {
        Ok(Some(w)) => w,
        Ok(None) => return JsonResponse::not_found("Workflow not found").into_response(),
        Err(_) => return JsonResponse::server_error("Failed").into_response(),
    };

    let plan_tier = match wf.workspace_id {
        Some(ws_id) => match app_state.workspace_repo.find_workspace(ws_id).await {
            Ok(Some(ws)) => NormalizedPlanTier::from_option(Some(ws.plan.as_str())),
            _ => NormalizedPlanTier::Solo,
        },
        None => NormalizedPlanTier::Solo,
    };
    if body.limit < 1 {
        return JsonResponse::bad_request("limit must be >= 1").into_response();
    }
    if plan_tier.is_solo() && body.limit > 1 {
        let violation = PlanViolation {
            code: "concurrency-limit",
            message: "Solo plan workflows run one job at a time. Upgrade in Settings → Plan to increase concurrency.".to_string(),
            node_label: None,
        };
        return plan_violation_response(vec![violation]);
    }
    match app_state
        .workflow_repo
        .set_workflow_concurrency_limit(wf.user_id, workflow_id, body.limit)
        .await
    {
        Ok(true) => Json(json!({"success": true, "limit": body.limit})).into_response(),
        Ok(false) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error setting concurrency: {:?}", e);
            JsonResponse::server_error("Failed to update").into_response()
        }
    }
}
