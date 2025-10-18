use super::{
    helpers::{enforce_solo_workflow_limit, plan_tier_str, SOLO_MONTHLY_RUN_LIMIT},
    prelude::*,
};

pub async fn get_plan_usage(
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

    let now = OffsetDateTime::now_utc();
    let start_of_month = now
        .replace_day(1)
        .unwrap_or(now)
        .replace_time(Time::MIDNIGHT);

    let runs_used = match app_state
        .workflow_repo
        .count_user_runs_since(user_id, start_of_month)
        .await
    {
        Ok(count) => count,
        Err(err) => {
            eprintln!("Failed to compute plan usage: {:?}", err);
            return JsonResponse::server_error("Failed to load plan usage").into_response();
        }
    };

    let workflows = match app_state
        .workflow_repo
        .list_workflows_by_user(user_id)
        .await
    {
        Ok(list) => list,
        Err(err) => {
            eprintln!("Failed to load workflows for usage: {:?}", err);
            return JsonResponse::server_error("Failed to load plan usage").into_response();
        }
    };
    let personal_count = workflows
        .iter()
        .filter(|workflow| workflow.workspace_id.is_none())
        .count();
    let hidden_count = if plan_tier.is_solo() {
        let allowed = enforce_solo_workflow_limit(&workflows);
        personal_count.saturating_sub(allowed.len())
    } else {
        0
    };

    let runs_limit = if plan_tier.is_solo() {
        Some(SOLO_MONTHLY_RUN_LIMIT)
    } else {
        None
    };
    let runs_period_start = start_of_month
        .format(&Rfc3339)
        .unwrap_or_else(|_| start_of_month.to_string());

    let mut runs_payload = json!({
        "used": runs_used,
        "period_start": runs_period_start,
    });
    if let Some(limit) = runs_limit {
        runs_payload["limit"] = json!(limit);
    }

    let mut workflows_payload = json!({ "total": workflows.len() });
    if plan_tier.is_solo() {
        workflows_payload["limit"] = json!(3);
        workflows_payload["hidden"] = json!(hidden_count);
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "plan": plan_tier_str(plan_tier),
            "runs": runs_payload,
            "workflows": workflows_payload,
        })),
    )
        .into_response()
}
