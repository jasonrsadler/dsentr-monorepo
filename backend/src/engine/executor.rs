use std::collections::HashSet;

use serde_json::{json, Map, Value};
use tracing::debug;

use crate::models::workflow_run::WorkflowRun;
use crate::state::AppState;

use super::actions::{execute_action, execute_condition, execute_trigger};
use super::graph::Graph;

pub async fn execute_run(state: AppState, run: WorkflowRun) {
    let Some(graph) = Graph::from_snapshot(&run.snapshot) else {
        let _ = state
            .workflow_repo
            .complete_workflow_run(run.id, "failed", Some("Invalid snapshot"))
            .await;
        return;
    };

    let mut context: Map<String, Value> = Map::new();
    if let Some(initial) = run.snapshot.get("_trigger_context") {
        let trigger_key = graph
            .nodes
            .values()
            .find(|n| n.kind == "trigger")
            .map(context_key);
        let key = trigger_key.unwrap_or_else(|| "trigger".to_string());
        context.insert(key, initial.clone());
    }

    let allowlist_env = std::env::var("ALLOWED_HTTP_DOMAINS")
        .ok()
        .unwrap_or_default();
    let mut allowed_hosts: Vec<String> = allowlist_env
        .split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    if let Some(arr) = run
        .snapshot
        .get("_egress_allowlist")
        .and_then(|v| v.as_array())
    {
        for v in arr {
            if let Some(s) = v.as_str() {
                let t = s.trim().to_lowercase();
                if !t.is_empty() {
                    allowed_hosts.push(t);
                }
            }
        }
    }
    allowed_hosts.sort();
    allowed_hosts.dedup();

    let disallow_env = std::env::var("DISALLOWED_HTTP_DOMAINS")
        .ok()
        .unwrap_or_default();
    let mut disallowed_hosts: Vec<String> = disallow_env
        .split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();

    let is_prod =
        std::env::var("ENV").ok().map(|v| v.to_lowercase()) == Some("production".to_string());
    if is_prod {
        disallowed_hosts.push("metadata.google.internal".to_string());
    }
    disallowed_hosts.sort();
    disallowed_hosts.dedup();

    let default_deny = std::env::var("EGRESS_DEFAULT_DENY")
        .ok()
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let mut visited: HashSet<String> = HashSet::new();
    let start_from = run
        .snapshot
        .get("_start_from_node")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut stack: Vec<String> = if let Some(start_id) = start_from {
        vec![start_id]
    } else {
        let mut s: Vec<String> = graph
            .nodes
            .values()
            .filter(|n| n.kind == "trigger")
            .map(|n| n.id.clone())
            .collect();
        if s.is_empty() {
            if let Some(first) = graph.nodes.keys().next() {
                s.push(first.clone());
            }
        }
        s
    };

    let mut canceled = false;
    while let Some(node_id) = stack.pop() {
        let _ = state
            .workflow_repo
            .renew_run_lease(run.id, &state.worker_id, state.worker_lease_seconds)
            .await;
        if let Ok(Some(status)) = state.workflow_repo.get_run_status(run.id).await {
            if status == "canceled" {
                canceled = true;
                break;
            }
        }
        if visited.contains(&node_id) {
            continue;
        }
        visited.insert(node_id.clone());

        let Some(node) = graph.nodes.get(&node_id) else {
            continue;
        };
        let kind = node.kind.as_str();
        let mut next_nodes: Vec<String> = vec![];

        let running = state
            .workflow_repo
            .upsert_node_run(
                run.id,
                &node.id,
                node.data
                    .get("label")
                    .and_then(|v| v.as_str())
                    .or(Some(kind))
                    .map(|s| s as &str),
                Some(kind),
                Some(node.data.clone()),
                None,
                "running",
                None,
            )
            .await
            .ok();

        let context_value = Value::Object(context.clone());
        let node_label = node
            .data
            .get("label")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        debug!(
            node_id = %node.id,
            node_kind = %node.kind,
            node_label,
            context = %context_value,
            "Executing workflow node"
        );

        let execution = match kind {
            "trigger" => execute_trigger(node, &context_value).await,
            "condition" => execute_condition(node, &context_value).await,
            "action" => {
                execute_action(
                    node,
                    &context_value,
                    &allowed_hosts,
                    &disallowed_hosts,
                    default_deny,
                    is_prod,
                    &state,
                    &run,
                )
                .await
            }
            _ => Ok((json!({"skipped": true}), None)),
        };

        match execution {
            Ok((outputs, selected_next)) => {
                if let Some(nr) = running {
                    let _ = state
                        .workflow_repo
                        .upsert_node_run(
                            run.id,
                            &node.id,
                            nr.name.as_deref(),
                            nr.node_type.as_deref(),
                            nr.inputs.clone(),
                            Some(outputs.clone()),
                            "succeeded",
                            None,
                        )
                        .await;
                }

                let key = context_key(node);
                context.insert(key, outputs.clone());

                match selected_next {
                    Some(next_id) => next_nodes.push(next_id),
                    None => {
                        if kind == "condition" {
                            let desired_handle = outputs
                                .get("result")
                                .and_then(|v| v.as_bool())
                                .map(|is_true| if is_true { "cond-true" } else { "cond-false" });

                            if let Some(handle) = desired_handle {
                                next_nodes.extend(
                                    graph
                                        .outgoing(&node_id)
                                        .iter()
                                        .filter(|edge| {
                                            edge.source_handle.as_deref() == Some(handle)
                                        })
                                        .map(|edge| edge.target.clone()),
                                );
                            } else {
                                next_nodes.extend(
                                    graph
                                        .outgoing(&node_id)
                                        .iter()
                                        .map(|edge| edge.target.clone()),
                                );
                            }
                        } else {
                            next_nodes.extend(
                                graph
                                    .outgoing(&node_id)
                                    .iter()
                                    .map(|edge| edge.target.clone()),
                            );
                        }
                    }
                }
            }
            Err(err_msg) => {
                if let Some(nr) = running {
                    let _ = state
                        .workflow_repo
                        .upsert_node_run(
                            run.id,
                            &node.id,
                            nr.name.as_deref(),
                            nr.node_type.as_deref(),
                            nr.inputs.clone(),
                            None,
                            "failed",
                            Some(&err_msg),
                        )
                        .await;
                }

                let stop_on_error = node
                    .data
                    .get("stopOnError")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if stop_on_error || kind != "action" {
                    let _ = state
                        .workflow_repo
                        .insert_dead_letter(
                            run.user_id,
                            run.workflow_id,
                            run.id,
                            &err_msg,
                            run.snapshot.clone(),
                        )
                        .await;
                    let _ = state
                        .workflow_repo
                        .complete_workflow_run(run.id, "failed", Some(&err_msg))
                        .await;
                    return;
                } else {
                    next_nodes.extend(
                        graph
                            .outgoing(&node_id)
                            .iter()
                            .map(|edge| edge.target.clone()),
                    );
                }
            }
        }

        for next in next_nodes.into_iter().rev() {
            stack.push(next);
        }
    }

    let _ = if canceled {
        state
            .workflow_repo
            .complete_workflow_run(run.id, "canceled", None)
            .await
    } else {
        state
            .workflow_repo
            .complete_workflow_run(run.id, "succeeded", None)
            .await
    };
}

fn context_key(node: &super::graph::Node) -> String {
    node.data
        .get("label")
        .and_then(|v| v.as_str())
        .map(|label| label.trim().to_lowercase())
        .filter(|label| !label.is_empty())
        .unwrap_or_else(|| node.id.clone())
}
