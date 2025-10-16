use std::collections::{BTreeMap, BTreeSet};

use super::prelude::*;

pub(crate) fn is_unique_violation(err: &sqlx::Error) -> bool {
    if let sqlx::Error::Database(db_err) = err {
        if let Some(code) = db_err.code() {
            return code == "23505";
        }
    }
    false
}

fn flatten_user_data(prefix: &str, value: &Value, out: &mut Vec<(String, Value)>) {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            for key in keys {
                let node_value = &map[key];
                let path = if prefix.is_empty() {
                    key.to_string()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten_user_data(&path, node_value, out);
            }
        }
        Value::Array(arr) => {
            for (idx, node_value) in arr.iter().enumerate() {
                let path = format!("{prefix}[{idx}]");
                flatten_user_data(&path, node_value, out);
            }
        }
        _ => out.push((prefix.to_string(), value.clone())),
    }
}

pub(crate) fn diff_user_nodes_only(before: &Value, after: &Value) -> Value {
    let mut before_flat: Vec<(String, Value)> = Vec::new();
    let mut after_flat: Vec<(String, Value)> = Vec::new();

    let collect = |root: &Value, bucket: &mut Vec<(String, Value)>| {
        if let Some(nodes) = root.get("nodes").and_then(|value| value.as_array()) {
            for (idx, node) in nodes.iter().enumerate() {
                if let Some(data) = node.get("data") {
                    flatten_user_data(&format!("nodes[{idx}].data"), data, bucket);
                }
            }
        }
    };

    collect(before, &mut before_flat);
    collect(after, &mut after_flat);

    let mut before_map = BTreeMap::new();
    for (key, value) in before_flat {
        before_map.insert(key, value);
    }
    let mut after_map = BTreeMap::new();
    for (key, value) in after_flat {
        after_map.insert(key, value);
    }

    let mut differences = vec![];
    let keys: BTreeSet<_> = before_map.keys().chain(after_map.keys()).cloned().collect();
    for key in keys {
        let before_value = before_map.get(&key);
        let after_value = after_map.get(&key);
        if before_value != after_value {
            differences.push(json!({
                "path": key,
                "from": before_value.cloned().unwrap_or(Value::Null),
                "to": after_value.cloned().unwrap_or(Value::Null),
            }));
        }
    }

    Value::Array(differences)
}

pub(crate) fn extract_schedule_config(graph: &Value) -> Option<Value> {
    let nodes = graph.get("nodes")?.as_array()?;
    for node in nodes {
        if node.get("type")?.as_str()? != "trigger" {
            continue;
        }
        let data = node.get("data")?;
        let trigger_type = data
            .get("triggerType")
            .and_then(|value| value.as_str())
            .unwrap_or("Manual");
        if !trigger_type.eq_ignore_ascii_case("schedule") {
            continue;
        }
        if let Some(cfg) = data.get("scheduleConfig") {
            return Some(cfg.clone());
        }
    }
    None
}

pub(crate) async fn sync_workflow_schedule(state: &AppState, workflow: &Workflow) {
    if let Err(error) = sync_workflow_schedule_inner(state, workflow).await {
        eprintln!(
            "Failed to sync schedule for workflow {}: {:?}",
            workflow.id, error
        );
    }
}

async fn sync_workflow_schedule_inner(
    state: &AppState,
    workflow: &Workflow,
) -> Result<(), sqlx::Error> {
    let schedule_value = extract_schedule_config(&workflow.data);
    let existing = state
        .workflow_repo
        .get_schedule_for_workflow(workflow.id)
        .await?;

    match schedule_value {
        Some(cfg_value) => {
            if let Some(cfg) = parse_schedule_config(&cfg_value) {
                let last_run = existing
                    .as_ref()
                    .and_then(|s| s.last_run_at)
                    .and_then(offset_to_utc);
                let now = Utc::now();
                if let Some(next_dt) = compute_next_run(&cfg, last_run, now) {
                    if let Some(next_offset) = utc_to_offset(next_dt) {
                        state
                            .workflow_repo
                            .upsert_workflow_schedule(
                                workflow.user_id,
                                workflow.id,
                                cfg_value,
                                Some(next_offset),
                            )
                            .await?;
                    } else {
                        state
                            .workflow_repo
                            .disable_workflow_schedule(workflow.id)
                            .await?;
                    }
                } else {
                    state
                        .workflow_repo
                        .disable_workflow_schedule(workflow.id)
                        .await?;
                }
            } else {
                state
                    .workflow_repo
                    .disable_workflow_schedule(workflow.id)
                    .await?;
            }
        }
        None => {
            state
                .workflow_repo
                .disable_workflow_schedule(workflow.id)
                .await?;
        }
    }

    Ok(())
}

pub(crate) fn plan_violation_response(violations: Vec<PlanViolation>) -> Response {
    let summary = if violations.len() == 1 {
        violations[0].message.clone()
    } else {
        "Solo plan restrictions prevent this workflow from running. Upgrade in Settings → Plan or adjust the nodes listed below.".to_string()
    };

    let details: Vec<Value> = violations
        .into_iter()
        .map(|violation| {
            let mut payload = json!({
                "code": violation.code,
                "message": violation.message,
            });
            if let Some(label) = violation.node_label {
                payload["nodeLabel"] = json!(label);
            }
            payload
        })
        .collect();

    (
        StatusCode::FORBIDDEN,
        Json(json!({
            "success": false,
            "status": "error",
            "message": summary,
            "violations": details,
        })),
    )
        .into_response()
}

pub(crate) fn enforce_solo_workflow_limit(workflows: &[Workflow]) -> Vec<Workflow> {
    let mut sorted = workflows.to_vec();
    sorted.sort_by_key(|wf| wf.created_at);
    sorted.into_iter().take(3).collect()
}

pub(crate) const SOLO_MONTHLY_RUN_LIMIT: i64 = 250;

pub(crate) fn plan_tier_str(tier: NormalizedPlanTier) -> &'static str {
    match tier {
        NormalizedPlanTier::Solo => "solo",
        NormalizedPlanTier::Workspace => "workspace",
    }
}
