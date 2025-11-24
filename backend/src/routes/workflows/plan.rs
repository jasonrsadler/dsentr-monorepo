use super::{
    helpers::{enforce_solo_workflow_limit, plan_tier_str, SOLO_MONTHLY_RUN_LIMIT},
    prelude::*,
};
use axum::extract::Query;
use serde::Deserialize;
use std::collections::HashMap;

use crate::state::workspace_quota_period_start;

#[derive(Deserialize)]
pub struct PlanUsageQuery {
    pub workspace: Option<Uuid>,
}

pub async fn get_plan_usage(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Query(query): Query<PlanUsageQuery>,
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

    let mut workspace_payload = None;
    if let Some(workspace_id) = query.workspace {
        match app_state
            .workspace_repo
            .is_member(workspace_id, user_id)
            .await
        {
            Ok(true) => {}
            Ok(false) => {
                return JsonResponse::forbidden(
                    "You are not a member of this workspace; switch workspaces to view its usage",
                )
                .into_response()
            }
            Err(err) => {
                eprintln!("Failed to verify workspace membership: {:?}", err);
                return JsonResponse::server_error("Failed to load plan usage").into_response();
            }
        }

        let workspace_plan = match app_state.workspace_repo.get_plan(workspace_id).await {
            Ok(plan) => plan,
            Err(err) => {
                eprintln!("Failed to load workspace plan: {:?}", err);
                return JsonResponse::server_error("Failed to load plan usage").into_response();
            }
        };

        if !matches!(workspace_plan, crate::models::plan::PlanTier::Workspace) {
            workspace_payload = Some(json!({
                "id": workspace_id,
                "plan": workspace_plan.as_str(),
            }));
        } else {
            let cycle = match app_state
                .workspace_repo
                .get_workspace_billing_cycle(workspace_id)
                .await
            {
                Ok(cycle) => cycle,
                Err(err) => {
                    eprintln!("Failed to load workspace billing cycle: {:?}", err);
                    return JsonResponse::server_error("Failed to load plan usage").into_response();
                }
            };

            let period_start = workspace_quota_period_start(cycle.as_ref(), now);
            let workspace_runs_limit = app_state.config.workspace_monthly_run_limit;
            let workspace_usage = match app_state
                .workspace_repo
                .get_workspace_run_quota(workspace_id, period_start)
                .await
            {
                Ok(usage) => usage,
                Err(err) => {
                    eprintln!("Failed to load workspace run usage: {:?}", err);
                    return JsonResponse::server_error("Failed to load plan usage").into_response();
                }
            };

            let workspace_runs_start = period_start
                .format(&Rfc3339)
                .unwrap_or_else(|_| period_start.to_string());

            let member_run_counts = match app_state
                .workflow_repo
                .list_workspace_member_run_counts(workspace_id, period_start)
                .await
            {
                Ok(list) => list,
                Err(err) => {
                    eprintln!("Failed to load workspace member run usage: {:?}", err);
                    return JsonResponse::server_error("Failed to load plan usage").into_response();
                }
            };

            let member_profiles = match app_state.workspace_repo.list_members(workspace_id).await {
                Ok(members) => members,
                Err(err) => {
                    eprintln!("Failed to load workspace members for usage: {:?}", err);
                    return JsonResponse::server_error("Failed to load plan usage").into_response();
                }
            };
            let member_lookup: HashMap<Uuid, crate::models::workspace::WorkspaceMember> =
                member_profiles
                    .into_iter()
                    .map(|member| (member.user_id, member))
                    .collect();
            let mut run_counts: HashMap<Uuid, i64> = member_run_counts
                .iter()
                .map(|entry| (entry.user_id, entry.run_count))
                .collect();

            let mut member_usage: Vec<serde_json::Value> = Vec::new();
            for member in member_lookup.values() {
                let runs = run_counts.remove(&member.user_id).unwrap_or(0);
                member_usage.push(json!({
                    "user_id": member.user_id,
                    "runs": runs,
                    "first_name": member.first_name,
                    "last_name": member.last_name,
                    "email": member.email,
                }));
            }

            for (user_id, runs) in run_counts {
                member_usage.push(json!({
                    "user_id": user_id,
                    "runs": runs,
                }));
            }

            let members_used = match app_state.workspace_repo.count_members(workspace_id).await {
                Ok(count) => count,
                Err(err) => {
                    eprintln!("Failed to count workspace members: {:?}", err);
                    return JsonResponse::server_error("Failed to load plan usage").into_response();
                }
            } + match app_state
                .workspace_repo
                .count_pending_workspace_invitations(workspace_id)
                .await
            {
                Ok(count) => count,
                Err(err) => {
                    eprintln!("Failed to count workspace invitations: {:?}", err);
                    return JsonResponse::server_error("Failed to load plan usage").into_response();
                }
            };

            let members_payload = json!({
                "used": members_used,
                "limit": app_state.config.workspace_member_limit,
            });

            workspace_payload = Some(json!({
                "id": workspace_id,
                "plan": workspace_plan.as_str(),
                "runs": {
                    "used": workspace_usage.run_count,
                    "limit": workspace_runs_limit,
                    "overage": workspace_usage.overage_count,
                    "period_start": workspace_runs_start,
                },
                "members": members_payload,
                "member_usage": member_usage,
            }));
        }
    }

    (
        StatusCode::OK,
        Json({
            let mut body = json!({
                "success": true,
                "plan": plan_tier_str(plan_tier),
                "runs": runs_payload,
                "workflows": workflows_payload,
            });
            if let Some(workspace) = workspace_payload {
                body["workspace"] = workspace;
            }
            body
        }),
    )
        .into_response()
}
