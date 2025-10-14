mod code;
mod email;
mod google;
mod http;
mod messaging;

use serde_json::{json, Value};

use crate::engine::templating::templ_str;
use crate::models::workflow_run::WorkflowRun;
use crate::state::AppState;

use super::graph::Node;

pub(crate) async fn execute_trigger(
    node: &Node,
    context: &Value,
) -> Result<(Value, Option<String>), String> {
    let mut map = serde_json::Map::new();
    if let Some(inputs) = node.data.get("inputs").and_then(|v| v.as_array()) {
        for kv in inputs {
            if let (Some(k), Some(v)) = (kv.get("key"), kv.get("value")) {
                if let Some(ks) = k.as_str() {
                    let value_raw = v.as_str().unwrap_or("");
                    let templated = templ_str(value_raw, context);
                    let parsed = parse_input_value(&templated);
                    map.insert(ks.to_string(), parsed);
                }
            }
        }
    }
    Ok((Value::Object(map), None))
}

pub(crate) async fn execute_condition(
    node: &Node,
    context: &Value,
) -> Result<(Value, Option<String>), String> {
    let expression = node
        .data
        .get("expression")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .unwrap_or("");

    let result = if !expression.is_empty() {
        evaluate_expression(expression, context)?
    } else {
        evaluate_legacy_condition(node, context)?
    };

    Ok((json!({"result": result}), None))
}

fn parse_input_value(raw: &str) -> Value {
    parse_flexible_value(raw)
}

fn evaluate_expression(expression: &str, context: &Value) -> Result<bool, String> {
    let trimmed = expression.trim();
    if trimmed.is_empty() {
        return Err("Condition expression is required".to_string());
    }

    let (op, left_raw, right_raw) =
        parse_expression(trimmed).ok_or_else(|| "Unsupported condition expression".to_string())?;

    let left = resolve_operand(&left_raw, context);
    let right = resolve_operand(&right_raw, context);

    Ok(match op {
        ConditionOperator::Equals => values_equal(&left, &right),
        ConditionOperator::NotEquals => !values_equal(&left, &right),
        ConditionOperator::GreaterThan => compare_order(&left, &right, ValueOrdering::Greater),
        ConditionOperator::LessThan => compare_order(&left, &right, ValueOrdering::Less),
        ConditionOperator::GreaterThanOrEqual => {
            compare_order(&left, &right, ValueOrdering::Equal)
                || compare_order(&left, &right, ValueOrdering::Greater)
        }
        ConditionOperator::LessThanOrEqual => {
            compare_order(&left, &right, ValueOrdering::Equal)
                || compare_order(&left, &right, ValueOrdering::Less)
        }
        ConditionOperator::Contains => {
            let Some(left_str) = value_as_string(&left) else {
                return Ok(false);
            };
            let Some(right_str) = value_as_string(&right) else {
                return Ok(false);
            };
            left_str.contains(&right_str)
        }
    })
}

fn evaluate_legacy_condition(node: &Node, context: &Value) -> Result<bool, String> {
    let field = node
        .data
        .get("field")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing condition field".to_string())?;
    let operator = node
        .data
        .get("operator")
        .and_then(|v| v.as_str())
        .unwrap_or("equals");
    let value_raw = node
        .data
        .get("value")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let actual_value = resolve_operand(field, context);
    let expected_value = resolve_operand(value_raw, context);

    Ok(match operator {
        "equals" => values_equal(&actual_value, &expected_value),
        "not equals" => !values_equal(&actual_value, &expected_value),
        "contains" => {
            let Some(left_str) = value_as_string(&actual_value) else {
                return Ok(false);
            };
            let Some(right_str) = value_as_string(&expected_value) else {
                return Ok(false);
            };
            left_str.contains(&right_str)
        }
        "greater than" => compare_order(&actual_value, &expected_value, ValueOrdering::Greater),
        "less than" => compare_order(&actual_value, &expected_value, ValueOrdering::Less),
        _ => false,
    })
}

#[derive(Clone, Copy)]
enum ConditionOperator {
    Equals,
    NotEquals,
    GreaterThan,
    LessThan,
    GreaterThanOrEqual,
    LessThanOrEqual,
    Contains,
}

fn parse_expression(expr: &str) -> Option<(ConditionOperator, String, String)> {
    const OPERATORS: &[(&str, ConditionOperator)] = &[
        (" contains ", ConditionOperator::Contains),
        (">=", ConditionOperator::GreaterThanOrEqual),
        ("<=", ConditionOperator::LessThanOrEqual),
        ("==", ConditionOperator::Equals),
        ("!=", ConditionOperator::NotEquals),
        (">", ConditionOperator::GreaterThan),
        ("<", ConditionOperator::LessThan),
    ];

    for (pattern, op) in OPERATORS {
        if let Some((left, right)) = expr.split_once(pattern) {
            return Some((*op, left.trim().to_string(), right.trim().to_string()));
        }
    }
    None
}

fn resolve_operand(raw: &str, context: &Value) -> Value {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Value::Null;
    }
    if let Some(val) = lookup_path(context, trimmed) {
        return val;
    }
    if let Value::Object(map) = context {
        for value in map.values() {
            if let Some(obj) = value.as_object() {
                if let Some(found) = obj.get(trimmed) {
                    return found.clone();
                }
            }
        }
    }
    let templated = templ_str(trimmed, context);
    parse_flexible_value(&templated)
}

fn lookup_path(context: &Value, path: &str) -> Option<Value> {
    let mut current = context;
    for part in path.split('.') {
        if part.is_empty() {
            continue;
        }
        match current {
            Value::Object(map) => current = map.get(part)?,
            Value::Array(arr) => {
                let idx: usize = part.parse().ok()?;
                current = arr.get(idx)?;
            }
            other => {
                return Some(other.clone());
            }
        }
    }
    Some(current.clone())
}

fn parse_flexible_value(raw: &str) -> Value {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Value::Null;
    }
    if let Ok(json_val) = serde_json::from_str::<Value>(trimmed) {
        return json_val;
    }
    if trimmed.len() >= 2
        && ((trimmed.starts_with('\"') && trimmed.ends_with('\"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        let inner = &trimmed[1..trimmed.len() - 1];
        return Value::String(inner.replace("\\\"", "\"").replace("\\'", "'"));
    }
    Value::String(trimmed.to_string())
}

fn values_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => a == b,
        (Value::String(a), Value::String(b)) => a == b,
        (Value::Bool(a), Value::Bool(b)) => a == b,
        (Value::Null, Value::Null) => true,
        _ => left == right || value_as_string(left) == value_as_string(right),
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ValueOrdering {
    Greater,
    Less,
    Equal,
}

fn compare_order(left: &Value, right: &Value, ordering: ValueOrdering) -> bool {
    if let (Some(a), Some(b)) = (value_as_f64(left), value_as_f64(right)) {
        return match ordering {
            ValueOrdering::Greater => a > b,
            ValueOrdering::Less => a < b,
            ValueOrdering::Equal => (a - b).abs() < f64::EPSILON,
        };
    }
    if let (Some(a), Some(b)) = (value_as_string(left), value_as_string(right)) {
        return match ordering {
            ValueOrdering::Greater => a > b,
            ValueOrdering::Less => a < b,
            ValueOrdering::Equal => a == b,
        };
    }
    false
}

fn value_as_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        Value::Bool(true) => Some(1.0),
        Value::Bool(false) => Some(0.0),
        _ => None,
    }
}

fn value_as_string(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => n.as_f64().map(|v| v.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Null => Some(String::new()),
        _ => None,
    }
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
        "messaging" => messaging::execute_messaging(node, context, state, run).await,
        "sheets" => google::execute_sheets(node, context, state, run).await,
        "code" => code::execute_code(node, context).await,
        _ => Ok((
            json!({"skipped": true, "reason": "unsupported actionType"}),
            None,
        )),
    }
}
