mod email;
mod http;

use serde_json::{json, Value};

use crate::models::workflow_run::WorkflowRun;
use crate::state::AppState;

use super::graph::{Edge, Node};

pub(crate) async fn execute_trigger(node: &Node) -> Result<(Value, Option<String>), String> {
    let mut map = serde_json::Map::new();
    if let Some(inputs) = node.data.get("inputs").and_then(|v| v.as_array()) {
        for kv in inputs {
            if let (Some(k), Some(v)) = (kv.get("key"), kv.get("value")) {
                if let Some(ks) = k.as_str() {
                    map.insert(ks.to_string(), v.clone());
                }
            }
        }
    }
    Ok((Value::Object(map), None))
}

pub(crate) async fn execute_condition(
    node: &Node,
    context: &Value,
    outgoing: &[Edge],
) -> Result<(Value, Option<String>), String> {
    let field = node
        .data
        .get("field")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing condition field".to_string())?;
    let operator = node
        .data
        .get("operator")
        .and_then(|v| v.as_str())
        .unwrap_or("equals");
    let value = node
        .data
        .get("value")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let actual = context.get(field).and_then(|v| v.as_str()).unwrap_or("");
    let result = match operator {
        "equals" => actual == value,
        "not equals" => actual != value,
        "contains" => actual.contains(value),
        "greater than" => {
            actual.parse::<f64>().unwrap_or(f64::NAN) > value.parse::<f64>().unwrap_or(f64::NAN)
        }
        "less than" => {
            actual.parse::<f64>().unwrap_or(f64::NAN) < value.parse::<f64>().unwrap_or(f64::NAN)
        }
        _ => false,
    };

    let wanted = if result {
        Some("cond-true")
    } else {
        Some("cond-false")
    };
    let selected = outgoing
        .iter()
        .find(|e| e.source_handle.as_deref() == wanted)
        .map(|e| e.target.clone());

    Ok((json!({"result": result}), selected))
}

pub(crate) async fn execute_action(
    node: &Node,
    context: &Value,
    allowed_hosts: &[String],
    disallowed_hosts: &[String],
    default_deny: bool,
    is_prod: bool,
    state: &AppState,
    run: &WorkflowRun,
) -> Result<(Value, Option<String>), String> {
    let action_type = node
        .data
        .get("actionType")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    match action_type.as_str() {
        "http" => {
            http::execute_http(
                node,
                context,
                allowed_hosts,
                disallowed_hosts,
                default_deny,
                is_prod,
                state,
                run,
            )
            .await
        }
        "email" => email::execute_email(node, context, state).await,
        _ => Ok((
            json!({"skipped": true, "reason": "unsupported actionType"}),
            None,
        )),
    }
}
