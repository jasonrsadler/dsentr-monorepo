use std::collections::{HashMap, HashSet};
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::{json, Value};

use crate::models::workflow_run::WorkflowRun;
use crate::state::AppState;

#[derive(Debug, Clone)]
struct Node {
    id: String,
    kind: String,
    data: Value,
}

#[derive(Debug, Clone)]
struct Edge {
    id: String,
    source: String,
    target: String,
    source_handle: Option<String>,
}

#[derive(Debug, Clone)]
struct Graph {
    nodes: HashMap<String, Node>,
    edges_out: HashMap<String, Vec<Edge>>, // source -> edges
}

impl Graph {
    fn from_snapshot(snapshot: &Value) -> Option<Self> {
        let mut nodes = HashMap::new();
        let mut edges_out: HashMap<String, Vec<Edge>> = HashMap::new();

        let nodes_val = snapshot.get("nodes").and_then(|v| v.as_array())?;
        let edges_val = snapshot.get("edges").and_then(|v| v.as_array())?;

        for n in nodes_val {
            let id = n.get("id")?.as_str()?.to_string();
            let kind = n.get("type")?.as_str()?.to_string();
            let data = n.get("data").cloned().unwrap_or(Value::Null);
            nodes.insert(id.clone(), Node { id, kind, data });
        }

        for e in edges_val {
            let id = e.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let source = e.get("source")?.as_str()?.to_string();
            let target = e.get("target")?.as_str()?.to_string();
            let source_handle = e
                .get("sourceHandle")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let edge = Edge {
                id,
                source: source.clone(),
                target,
                source_handle,
            };
            edges_out.entry(source).or_default().push(edge);
        }

        Some(Graph { nodes, edges_out })
    }

    fn outgoing(&self, node_id: &str) -> &[Edge] {
        self.edges_out.get(node_id).map(|v| v.as_slice()).unwrap_or(&[])
    }
}

pub async fn execute_run(state: AppState, run: WorkflowRun) {
    // Parse snapshot
    let Some(graph) = Graph::from_snapshot(&run.snapshot) else {
        let _ = state
            .workflow_repo
            .complete_workflow_run(run.id, "failed", Some("Invalid snapshot"))
            .await;
        return;
    };

    // Build initial context: webhook payload (if any) merged with first trigger inputs
    let mut context = run
        .snapshot
        .get("_trigger_context")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if let Some(trigger) = graph
        .nodes
        .values()
        .find(|n| n.kind == "trigger")
    {
        if let Some(inputs) = trigger.data.get("inputs").and_then(|v| v.as_array()) {
            let mut map = context.as_object().cloned().unwrap_or_default();
            for kv in inputs {
                if let (Some(k), Some(v)) = (kv.get("key"), kv.get("value")) {
                    if let Some(ks) = k.as_str() {
                        map.insert(ks.to_string(), v.clone());
                    }
                }
            }
            context = Value::Object(map);
        }
    }

    // Traverse from triggers; naive DFS avoiding cycles
    let mut visited: HashSet<String> = HashSet::new();
    let mut stack: Vec<String> = graph
        .nodes
        .values()
        .filter(|n| n.kind == "trigger")
        .map(|n| n.id.clone())
        .collect();

    // If no trigger, start from any node with no incoming edge
    if stack.is_empty() {
        if let Some(first) = graph.nodes.keys().next() {
            stack.push(first.clone());
        }
    }

    while let Some(node_id) = stack.pop() {
        if visited.contains(&node_id) {
            continue;
        }
        visited.insert(node_id.clone());

        let Some(node) = graph.nodes.get(&node_id) else { continue };
        let kind = node.kind.as_str();
        let mut next_nodes: Vec<String> = vec![];

        let execution = match kind {
            "trigger" => execute_trigger(node).await,
            "condition" => execute_condition(node, &context, graph.outgoing(&node_id)).await,
            "action" => execute_action(node, &context).await,
            _ => Ok((json!({"skipped": true}), None)),
        };

        match execution {
            Ok((outputs, selected_next)) => {
                // Record node run as succeeded
                let _ = state
                    .workflow_repo
                    .insert_node_run(
                        run.id,
                        &node.id,
                        node.data
                            .get("label")
                            .and_then(|v| v.as_str())
                            .or_else(|| Some(kind))
                            .map(|s| s as &str),
                        Some(kind),
                        Some(node.data.clone()),
                        Some(outputs.clone()),
                        "succeeded",
                        None,
                    )
                    .await;

                // Merge outputs into context under node.id
                if let Some(obj) = context.as_object_mut() {
                    obj.insert(node.id.clone(), outputs);
                }

                // Determine next node(s)
                match selected_next {
                    Some(next_id) => next_nodes.push(next_id),
                    None => {
                        // default: follow first outgoing edge if any
                        if let Some(edge) = graph.outgoing(&node_id).first() {
                            next_nodes.push(edge.target.clone());
                        }
                    }
                }
            }
            Err(err_msg) => {
                let _ = state
                    .workflow_repo
                    .insert_node_run(
                        run.id,
                        &node.id,
                        node.data
                            .get("label")
                            .and_then(|v| v.as_str())
                            .or_else(|| Some(kind))
                            .map(|s| s as &str),
                        Some(kind),
                        Some(node.data.clone()),
                        None,
                        "failed",
                        Some(&err_msg),
                    )
                    .await;

                // stopOnError default true for action; for others stop
                let stop_on_error = node
                    .data
                    .get("stopOnError")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if stop_on_error || kind != "action" {
                    let _ = state
                        .workflow_repo
                        .complete_workflow_run(run.id, "failed", Some(&err_msg))
                        .await;
                    return;
                } else {
                    // Continue on error: pick next outgoing if present
                    if let Some(edge) = graph.outgoing(&node_id).first() {
                        next_nodes.push(edge.target.clone());
                    }
                }
            }
        }

        // Push next nodes onto stack (LIFO)
        for next in next_nodes.into_iter().rev() {
            stack.push(next);
        }
    }

    // Completed traversal
    let _ = state
        .workflow_repo
        .complete_workflow_run(run.id, "succeeded", None)
        .await;
}

async fn execute_trigger(node: &Node) -> Result<(Value, Option<String>), String> {
    // Collect input pairs into object
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

async fn execute_condition(
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
        "greater than" => actual.parse::<f64>().unwrap_or(f64::NAN)
            > value.parse::<f64>().unwrap_or(f64::NAN),
        "less than" => actual.parse::<f64>().unwrap_or(f64::NAN)
            < value.parse::<f64>().unwrap_or(f64::NAN),
        _ => false,
    };

    // Pick the appropriate edge by handle
    let wanted = if result { Some("cond-true") } else { Some("cond-false") };
    let selected = outgoing
        .iter()
        .find(|e| e.source_handle.as_deref() == wanted)
        .map(|e| e.target.clone());

    Ok((json!({"result": result}), selected))
}

async fn execute_action(node: &Node, context: &Value) -> Result<(Value, Option<String>), String> {
    let action_type = node
        .data
        .get("actionType")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    match action_type.as_str() {
        "http" => execute_http(node, context).await,
        _ => Ok((json!({"skipped": true, "reason": "unsupported actionType"}), None)),
    }
}

fn templ_str(s: &str, ctx: &Value) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find("{{") {
        let (head, tail) = rest.split_at(start);
        out.push_str(head);
        if let Some(end_rel) = tail.find("}}") {
            let (expr_with, new_rest) = tail.split_at(end_rel + 2);
            let expr = expr_with.trim_start_matches("{{").trim_end_matches("}}").trim();
            let val = lookup_ctx(expr, ctx).unwrap_or_default();
            out.push_str(&val);
            rest = new_rest;
        } else {
            out.push_str(tail);
            rest = "";
            break;
        }
    }
    out.push_str(rest);
    out
}

fn lookup_ctx(path: &str, ctx: &Value) -> Option<String> {
    let mut cur = ctx;
    for part in path.split('.') {
        if part.is_empty() { continue; }
        match cur {
            Value::Object(map) => { cur = map.get(part)?; }
            Value::Array(arr) => { let idx: usize = part.parse().ok()?; cur = arr.get(idx)?; }
            _ => { return Some(cur.to_string().trim_matches('"').to_string()); }
        }
    }
    Some(match cur { Value::String(s) => s.clone(), other => other.to_string() })
}

async fn execute_http(node: &Node, context: &Value) -> Result<(Value, Option<String>), String> {
    let params = node.data.get("params").cloned().unwrap_or(Value::Null);
    let url = params
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "HTTP url is required".to_string())?;
    let method = params
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET");
    let body_type = params
        .get("bodyType")
        .and_then(|v| v.as_str())
        .unwrap_or("raw");
    let timeout_ms = node
        .data
        .get("timeout")
        .and_then(|v| v.as_u64())
        .unwrap_or(30_000);
    let retries = node
        .data
        .get("retries")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;
    let follow = params
        .get("followRedirects")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let auth_type = params
        .get("authType")
        .and_then(|v| v.as_str())
        .unwrap_or("none");

    let client = reqwest::Client::builder()
        .redirect(if follow {
            reqwest::redirect::Policy::limited(10)
        } else {
            reqwest::redirect::Policy::none()
        })
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| e.to_string())?;

    let mut headers = HeaderMap::new();
    if let Some(hs) = params.get("headers").and_then(|v| v.as_array()) {
        for h in hs {
            if let (Some(k), Some(v)) = (h.get("key").and_then(|v| v.as_str()), h.get("value").and_then(|v| v.as_str())) {
                let v_resolved = templ_str(v, context);
                if let Ok(name) = HeaderName::try_from(k) {
                    if let Ok(val) = HeaderValue::from_str(&v_resolved) {
                        headers.append(name, val);
                    }
                }
            }
        }
    }

    // Query params
    let mut url_parsed = url.to_string();
    if let Some(qs) = params.get("queryParams").and_then(|v| v.as_array()) {
        let mut first = !url.contains('?');
        for qp in qs {
            if let (Some(k), Some(v)) = (qp.get("key").and_then(|v| v.as_str()), qp.get("value").and_then(|v| v.as_str())) {
                let v_resolved = templ_str(v, context);
                url_parsed.push(if first { '?' } else { '&' });
                first = false;
                url_parsed.push_str(&format!("{}={}", urlencoding::encode(k), urlencoding::encode(&v_resolved)));
            }
        }
    }

    let mut attempt = 0usize;
    loop {
        attempt += 1;
        let req_builder = match method {
            "GET" => client.get(&url_parsed),
            "POST" => client.post(&url_parsed),
            "PUT" => client.put(&url_parsed),
            "PATCH" => client.patch(&url_parsed),
            "DELETE" => client.delete(&url_parsed),
            "HEAD" => client.head(&url_parsed),
            _ => client.get(&url_parsed),
        };

        let req_builder = req_builder.headers(headers.clone());

        let req_builder = match auth_type {
            "basic" => {
                let user = params.get("username").and_then(|v| v.as_str()).unwrap_or("");
                let pass = params.get("password").and_then(|v| v.as_str()).unwrap_or("");
                req_builder.basic_auth(user.to_string(), Some(pass.to_string()))
            }
            "bearer" => {
                let token = params.get("token").and_then(|v| v.as_str()).unwrap_or("");
                req_builder.bearer_auth(token.to_string())
            }
            _ => req_builder,
        };

        let req_builder = if matches!(method, "GET" | "DELETE" | "HEAD") {
            req_builder
        } else {
            match body_type {
                "json" => {
                    let body_str_raw = params.get("body").and_then(|v| v.as_str()).unwrap_or("");
                    let body_str = templ_str(body_str_raw, context);
                    if body_str.is_empty() {
                        req_builder
                    } else {
                        match serde_json::from_str::<Value>(&body_str) {
                            Ok(json_body) => req_builder.json(&json_body),
                            Err(_) => req_builder.body(body_str.to_string()),
                        }
                    }
                }
                "form" => {
                    let mut form = vec![];
                    if let Some(form_body) = params.get("formBody").and_then(|v| v.as_array()) {
                        for kv in form_body {
                            if let (Some(k), Some(v)) = (kv.get("key").and_then(|v| v.as_str()), kv.get("value").and_then(|v| v.as_str())) {
                                form.push((k.to_string(), templ_str(v, context)));
                            }
                        }
                    }
                    req_builder.form(&form)
                }
                _ => {
                    let body_str_raw = params.get("body").and_then(|v| v.as_str()).unwrap_or("");
                    let body_str = templ_str(body_str_raw, context);
                    req_builder.body(body_str)
                }
            }
        };

        let resp_res = req_builder.send().await;
        match resp_res {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let mut header_map = serde_json::Map::new();
                for (k, v) in resp.headers().iter() {
                    if let Ok(s) = v.to_str() {
                        header_map.insert(k.as_str().to_string(), Value::String(s.to_string()));
                    }
                }
                let content_type = resp
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                let text = resp.text().await.unwrap_or_default();
                let body_value = if content_type.contains("application/json") {
                    serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text))
                } else {
                    Value::String(text)
                };
                let outputs = json!({
                    "status": status,
                    "headers": header_map,
                    "body": body_value,
                });
                return Ok((outputs, None));
            }
            Err(err) => {
                if attempt <= retries + 1 {
                    // basic backoff
                    tokio::time::sleep(Duration::from_millis(250 * attempt as u64)).await;
                    continue;
                } else {
                    return Err(err.to_string());
                }
            }
        }
    }
}

async fn execute_email(node: &Node, context: &Value, state: &AppState) -> Result<(Value, Option<String>), String> {
    let params = node.data.get("params").cloned().unwrap_or(Value::Null);
    let service = params.get("service").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
    let to = params.get("to").and_then(|v| v.as_str()).ok_or_else(|| "Missing 'to'".to_string())?;
    let subject_raw = params.get("subject").and_then(|v| v.as_str()).unwrap_or("");
    let body_raw = params.get("body").and_then(|v| v.as_str()).unwrap_or("");
    let subject = templ_str(subject_raw, context);
    let body = templ_str(body_raw, context);
    match service.as_str() {
        "smtp" => {
            state
                .mailer
                .send_email_generic(to, &subject, &body)
                .await
                .map_err(|e| e.to_string())?;
            Ok((json!({"sent": true, "service": "SMTP"}), None))
        }
        _ => Err("Unsupported email service".to_string()),
    }
}
