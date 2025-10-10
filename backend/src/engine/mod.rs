use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::redirect;
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
            let id = e
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
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
        self.edges_out
            .get(node_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
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
    if let Some(trigger) = graph.nodes.values().find(|n| n.kind == "trigger") {
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

    // Build egress allowlist union (env + per-workflow from snapshot)
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

    // Global disallowed denylist (always takes precedence)
    let disallow_env = std::env::var("DISALLOWED_HTTP_DOMAINS")
        .ok()
        .unwrap_or_default();
    let mut disallowed_hosts: Vec<String> = disallow_env
        .split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();

    // Optional hardening: block metadata/private/loopback only in production
    let is_prod =
        std::env::var("ENV").ok().map(|v| v.to_lowercase()) == Some("production".to_string());
    if is_prod {
        disallowed_hosts.push("metadata.google.internal".to_string());
        // add more known metadata domains if needed
    }
    disallowed_hosts.sort();
    disallowed_hosts.dedup();

    // Default deny toggle
    let default_deny = std::env::var("EGRESS_DEFAULT_DENY")
        .ok()
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    // Traverse from triggers; naive DFS avoiding cycles
    let mut visited: HashSet<String> = HashSet::new();
    // Allow rerun to start from a specific node if provided in snapshot
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
        // If no trigger, start from any node
        if s.is_empty() {
            if let Some(first) = graph.nodes.keys().next() {
                s.push(first.clone());
            }
        }
        s
    };

    let mut canceled = false;
    while let Some(node_id) = stack.pop() {
        // Renew lease/heartbeat so this worker retains ownership
        let _ = state
            .workflow_repo
            .renew_run_lease(run.id, &state.worker_id, state.worker_lease_seconds)
            .await;
        // Check cancellation before executing next node
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

        // Upsert running node_run (idempotent by run_id+node_id)
        let running = state
            .workflow_repo
            .upsert_node_run(
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
                "running",
                None,
            )
            .await
            .ok();

        let execution = match kind {
            "trigger" => execute_trigger(node).await,
            "condition" => execute_condition(node, &context, graph.outgoing(&node_id)).await,
            "action" => {
                execute_action(
                    node,
                    &context,
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
                // Update node run to succeeded
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

                // stopOnError default true for action; for others stop
                let stop_on_error = node
                    .data
                    .get("stopOnError")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if stop_on_error || kind != "action" {
                    // Capture dead letter entry for quick requeue
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

    // Completed traversal or canceled
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
        "greater than" => {
            actual.parse::<f64>().unwrap_or(f64::NAN) > value.parse::<f64>().unwrap_or(f64::NAN)
        }
        "less than" => {
            actual.parse::<f64>().unwrap_or(f64::NAN) < value.parse::<f64>().unwrap_or(f64::NAN)
        }
        _ => false,
    };

    // Pick the appropriate edge by handle
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

async fn execute_action(
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
            execute_http(
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
        "email" => execute_email(node, context, state).await,
        _ => Ok((
            json!({"skipped": true, "reason": "unsupported actionType"}),
            None,
        )),
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
            let expr = expr_with
                .trim_start_matches("{{")
                .trim_end_matches("}}")
                .trim();
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
        if part.is_empty() {
            continue;
        }
        match cur {
            Value::Object(map) => {
                cur = map.get(part)?;
            }
            Value::Array(arr) => {
                let idx: usize = part.parse().ok()?;
                cur = arr.get(idx)?;
            }
            _ => {
                return Some(cur.to_string().trim_matches('"').to_string());
            }
        }
    }
    Some(match cur {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    })
}

fn mask_json(value: &Value, secrets: &[String]) -> Value {
    match value {
        Value::String(s) => {
            let mut out = s.clone();
            for sec in secrets {
                if !sec.is_empty() && sec.len() >= 4 {
                    out = out.replace(sec, "[REDACTED]");
                }
            }
            Value::String(out)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(|v| mask_json(v, secrets)).collect()),
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map.iter() {
                out.insert(k.clone(), mask_json(v, secrets));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

fn is_ip_blocked(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            let a = octets[0];
            let b = octets[1];
            // 127.0.0.0/8 loopback
            if a == 127 {
                return true;
            }
            // 10.0.0.0/8
            if a == 10 {
                return true;
            }
            // 172.16.0.0/12
            if a == 172 && (16..=31).contains(&b) {
                return true;
            }
            // 192.168.0.0/16
            if a == 192 && b == 168 {
                return true;
            }
            // 169.254.0.0/16 link-local
            if a == 169 && b == 254 {
                return true;
            }
            // Common metadata IPs
            if *v4 == Ipv4Addr::new(169, 254, 169, 254) {
                return true;
            }
            false
        }
        IpAddr::V6(v6) => {
            // ::1 loopback
            if *v6 == Ipv6Addr::LOCALHOST {
                return true;
            }
            // fc00::/7 Unique local addresses
            let seg0 = v6.segments()[0];
            if (seg0 & 0xfe00) == 0xfc00 {
                return true;
            }
            // fe80::/10 link-local
            if (seg0 & 0xffc0) == 0xfe80 {
                return true;
            }
            false
        }
    }
}

fn is_host_blocked(host: &str, patterns: &[String]) -> bool {
    let h = host.to_lowercase();
    for pat in patterns {
        if let Some(suffix) = pat.strip_prefix("*.") {
            if h.ends_with(suffix) && h.len() > suffix.len() {
                if let Some(pos) = h.rfind(suffix) {
                    if pos > 0 && h.as_bytes()[pos - 1] == b'.' {
                        return true;
                    }
                }
            }
        } else if h == pat.as_str() {
            return true;
        }
    }
    false
}

async fn execute_http(
    node: &Node,
    context: &Value,
    allowed_hosts: &[String],
    disallowed_hosts: &[String],
    default_deny: bool,
    is_prod: bool,
    state: &AppState,
    run: &WorkflowRun,
) -> Result<(Value, Option<String>), String> {
    let params = node.data.get("params").cloned().unwrap_or(Value::Null);
    let url_raw = params
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "HTTP url is required".to_string())?;
    let url = templ_str(url_raw, context);
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

    // Egress allowlist
    let allowed: Vec<String> = allowed_hosts.to_vec();

    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    let scheme_ok = matches!(parsed.scheme(), "http" | "https");
    if !scheme_ok {
        return Err("Only http/https schemes are allowed".to_string());
    }
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    // Global denylist first
    if is_host_blocked(&host, disallowed_hosts) {
        let msg = format!("Outbound HTTP blocked by denylist: {}", host);
        let _ = state
            .workflow_repo
            .insert_egress_block_event(
                run.user_id,
                run.workflow_id,
                run.id,
                &node.id,
                &url,
                &host,
                "denylist",
                &msg,
            )
            .await;
        let detail = json!({"error":"egress_blocked","host":host,"rule":"denylist","message":msg});
        return Err(detail.to_string());
    }
    if let Some(ip) = parsed.host_str().and_then(|h| h.parse::<IpAddr>().ok()) {
        if is_prod && is_ip_blocked(&ip) {
            let msg = "Outbound HTTP blocked by SSRF hardening".to_string();
            let _ = state
                .workflow_repo
                .insert_egress_block_event(
                    run.user_id,
                    run.workflow_id,
                    run.id,
                    &node.id,
                    &url,
                    &host,
                    "ssrf_hardening",
                    &msg,
                )
                .await;
            let detail =
                json!({"error":"egress_blocked","host":host,"rule":"ssrf_hardening","message":msg});
            return Err(detail.to_string());
        }
    }
    // Allowlist logic
    if default_deny {
        if allowed.is_empty() || !is_host_allowed(&host, &allowed) {
            let msg = format!("Outbound HTTP not allowed (default-deny): {}", host);
            let _ = state
                .workflow_repo
                .insert_egress_block_event(
                    run.user_id,
                    run.workflow_id,
                    run.id,
                    &node.id,
                    &url,
                    &host,
                    "default_deny",
                    &msg,
                )
                .await;
            let detail =
                json!({"error":"egress_blocked","host":host,"rule":"default_deny","message":msg});
            return Err(detail.to_string());
        }
    } else if !allowed.is_empty() {
        if !is_host_allowed(&host, &allowed) {
            let msg = format!("Outbound HTTP not allowed: {}", host);
            let _ = state
                .workflow_repo
                .insert_egress_block_event(
                    run.user_id,
                    run.workflow_id,
                    run.id,
                    &node.id,
                    &url,
                    &host,
                    "allowlist_miss",
                    &msg,
                )
                .await;
            let detail =
                json!({"error":"egress_blocked","host":host,"rule":"allowlist_miss","message":msg});
            return Err(detail.to_string());
        }
    }

    let redirect_policy = if follow {
        let allowed_clone = allowed.clone();
        let disallowed_clone = disallowed_hosts.to_vec();
        let default_deny_local = default_deny;
        let is_prod_local = is_prod;
        redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 10 {
                return attempt.stop();
            }
            let next = attempt.url();
            let host = next.host_str().unwrap_or("").to_lowercase();
            if is_host_blocked(&host, &disallowed_clone) {
                return attempt.stop();
            }
            if let Some(ip) = next.host_str().and_then(|h| h.parse::<IpAddr>().ok()) {
                if is_prod_local && is_ip_blocked(&ip) {
                    return attempt.stop();
                }
            }
            if default_deny_local {
                if is_host_allowed(&host, &allowed_clone) {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            } else {
                if allowed_clone.is_empty() || is_host_allowed(&host, &allowed_clone) {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }
        })
    } else {
        redirect::Policy::none()
    };

    let client = reqwest::Client::builder()
        .redirect(redirect_policy)
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| e.to_string())?;

    let mut headers = HeaderMap::new();
    if let Some(hs) = params.get("headers").and_then(|v| v.as_array()) {
        for h in hs {
            if let (Some(k), Some(v)) = (
                h.get("key").and_then(|v| v.as_str()),
                h.get("value").and_then(|v| v.as_str()),
            ) {
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
            if let (Some(k), Some(v)) = (
                qp.get("key").and_then(|v| v.as_str()),
                qp.get("value").and_then(|v| v.as_str()),
            ) {
                let v_resolved = templ_str(v, context);
                url_parsed.push(if first { '?' } else { '&' });
                first = false;
                url_parsed.push_str(&format!(
                    "{}={}",
                    urlencoding::encode(k),
                    urlencoding::encode(&v_resolved)
                ));
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
                let user = params
                    .get("username")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let pass = params
                    .get("password")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
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
                            if let (Some(k), Some(v)) = (
                                kv.get("key").and_then(|v| v.as_str()),
                                kv.get("value").and_then(|v| v.as_str()),
                            ) {
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
                let outputs_raw = json!({
                    "status": status,
                    "headers": header_map,
                    "body": body_value,
                });
                let secrets_env = std::env::var("MASK_SECRETS").ok().unwrap_or_default();
                let secrets: Vec<String> = secrets_env
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                let outputs = mask_json(&outputs_raw, &secrets);
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

fn is_host_allowed(host: &str, patterns: &[String]) -> bool {
    if host.is_empty() {
        return false;
    }
    for pat in patterns {
        if let Some(suffix) = pat.strip_prefix("*.") {
            if host.ends_with(suffix) && host.len() > suffix.len() {
                if let Some(pos) = host.rfind(suffix) {
                    if pos > 0 && host.as_bytes()[pos - 1] == b'.' {
                        return true;
                    }
                }
            }
        } else if host == pat.as_str() {
            return true;
        }
    }
    false
}

fn is_valid_email_address(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.contains(' ') {
        return false;
    }
    let mut parts = trimmed.split('@');
    let local = parts.next().unwrap_or("");
    let domain = match parts.next() {
        Some(d) => d,
        None => return false,
    };
    if parts.next().is_some() {
        return false;
    }
    if local.is_empty() || domain.is_empty() {
        return false;
    }
    if domain.starts_with('.') || domain.ends_with('.') {
        return false;
    }
    domain.contains('.')
}

fn parse_recipient_list(raw: &str) -> Result<Vec<String>, String> {
    let mut recipients = Vec::new();
    let mut seen = HashSet::new();
    for entry in raw.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
        if !is_valid_email_address(entry) {
            return Err(format!("Invalid recipient email: {}", entry));
        }
        let lowered = entry.to_lowercase();
        if !seen.insert(lowered) {
            return Err(format!("Duplicate recipient email: {}", entry));
        }
        recipients.push(entry.to_string());
    }
    if recipients.is_empty() {
        return Err("Recipient email(s) required".to_string());
    }
    Ok(recipients)
}

async fn execute_email(
    node: &Node,
    context: &Value,
    state: &AppState,
) -> Result<(Value, Option<String>), String> {
    let params = node.data.get("params").cloned().unwrap_or(Value::Null);
    let service = params
        .get("service")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();

    match service.as_str() {
        "smtp" => {
            let to = params
                .get("to")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing 'to'".to_string())?;
            let subject_raw = params.get("subject").and_then(|v| v.as_str()).unwrap_or("");
            let body_raw = params.get("body").and_then(|v| v.as_str()).unwrap_or("");
            let subject = templ_str(subject_raw, context);
            let body = templ_str(body_raw, context);
            state
                .mailer
                .send_email_generic(to, &subject, &body)
                .await
                .map_err(|e| e.to_string())?;
            Ok((json!({"sent": true, "service": "SMTP"}), None))
        }
        "sendgrid" => {
            let api_key = params
                .get("apiKey")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "SendGrid API key is required".to_string())?
                .to_string();

            let from_email = params
                .get("from")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "From email is required".to_string())?;
            if !is_valid_email_address(from_email) {
                return Err("Invalid from email address".to_string());
            }

            let to_raw = params
                .get("to")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Recipient email(s) required".to_string())?;
            let recipients = parse_recipient_list(to_raw)?;

            let subject_raw = params.get("subject").and_then(|v| v.as_str()).unwrap_or("");
            let body_raw = params.get("body").and_then(|v| v.as_str()).unwrap_or("");
            let subject = templ_str(subject_raw, context);
            let body = templ_str(body_raw, context);

            let template_id = params
                .get("templateId")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());

            if template_id.is_none() {
                if subject.trim().is_empty() {
                    return Err(
                        "Subject is required for SendGrid emails without a template".to_string()
                    );
                }
                if body.trim().is_empty() {
                    return Err(
                        "Message body is required for SendGrid emails without a template"
                            .to_string(),
                    );
                }
            }

            let mut personalization = serde_json::Map::new();
            personalization.insert(
                "to".to_string(),
                Value::Array(
                    recipients
                        .iter()
                        .map(|email| json!({ "email": email }))
                        .collect(),
                ),
            );

            if template_id.is_none() {
                personalization.insert("subject".to_string(), Value::String(subject.clone()));
            }

            if let Some(substitutions) = params.get("substitutions").and_then(|v| v.as_array()) {
                let mut template_data = serde_json::Map::new();
                for pair in substitutions {
                    let Some(key) = pair.get("key").and_then(|v| v.as_str()).map(|s| s.trim())
                    else {
                        continue;
                    };
                    if key.is_empty() {
                        continue;
                    }
                    let value_raw = pair.get("value").and_then(|v| v.as_str()).unwrap_or("");
                    let resolved = templ_str(value_raw, context);
                    template_data.insert(key.to_string(), Value::String(resolved));
                }
                if !template_data.is_empty() {
                    personalization.insert(
                        "dynamic_template_data".to_string(),
                        Value::Object(template_data),
                    );
                }
            }

            let mut request_body = serde_json::Map::new();
            request_body.insert("from".to_string(), json!({ "email": from_email }));
            request_body.insert(
                "personalizations".to_string(),
                Value::Array(vec![Value::Object(personalization)]),
            );

            if let Some(tpl) = template_id {
                request_body.insert("template_id".to_string(), Value::String(tpl));
            } else {
                request_body.insert(
                    "content".to_string(),
                    Value::Array(vec![json!({ "type": "text/plain", "value": body })]),
                );
            }

            let base = std::env::var("SENDGRID_API_BASE")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| "https://api.sendgrid.com/v3".to_string());
            let url = format!("{}/mail/send", base.trim_end_matches('/'));

            let client = reqwest::Client::new();
            let resp = client
                .post(url)
                .bearer_auth(api_key)
                .json(&Value::Object(request_body))
                .send()
                .await
                .map_err(|e| e.to_string())?;

            let status = resp.status();
            if !status.is_success() {
                let body_text = resp.text().await.unwrap_or_default();
                return Err(format!(
                    "SendGrid request failed (status {}): {}",
                    status.as_u16(),
                    body_text
                ));
            }

            let message_id = resp
                .headers()
                .get("x-message-id")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            Ok((
                json!({
                    "sent": true,
                    "service": "SendGrid",
                    "status": status.as_u16(),
                    "message_id": message_id.clone()
                }),
                message_id,
            ))
        }
        _ => Err("Unsupported email service".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::mock_db::{MockDb, NoopWorkflowRepository};
    use crate::services::oauth::github::mock_github_oauth::MockGitHubOAuth;
    use crate::services::oauth::google::mock_google_oauth::MockGoogleOAuth;
    use crate::services::smtp_mailer::MockMailer;
    use crate::state::AppState;
    use axum::body::{Body, Bytes};
    use axum::extract::State;
    use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
    use axum::response::Response;
    use axum::routing::post;
    use axum::Router;
    use serde_json::{json, Value};
    use std::net::SocketAddr;
    use std::sync::Arc;
    use tokio::net::TcpListener;
    use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
    use tokio::task::JoinHandle;

    struct EnvGuard(&'static str);

    impl EnvGuard {
        fn set(key: &'static str, value: String) -> Self {
            std::env::set_var(key, value);
            Self(key)
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            std::env::remove_var(self.0);
        }
    }

    fn test_state() -> AppState {
        AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo: Arc::new(NoopWorkflowRepository::default()),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            worker_id: Arc::new("worker".to_string()),
            worker_lease_seconds: 30,
        }
    }

    #[derive(Debug)]
    struct RecordedRequest {
        method: Method,
        uri: Uri,
        headers: HeaderMap,
        body: Vec<u8>,
    }

    struct StubState<F>
    where
        F: Fn() -> Response<Body> + Send + Sync + 'static,
    {
        tx: UnboundedSender<RecordedRequest>,
        response_factory: Arc<F>,
    }

    impl<F> Clone for StubState<F>
    where
        F: Fn() -> Response<Body> + Send + Sync + 'static,
    {
        fn clone(&self) -> Self {
            Self {
                tx: self.tx.clone(),
                response_factory: Arc::clone(&self.response_factory),
            }
        }
    }

    async fn stub_handler<F>(
        State(state): State<StubState<F>>,
        method: Method,
        uri: Uri,
        headers: HeaderMap,
        body: Bytes,
    ) -> Response<Body>
    where
        F: Fn() -> Response<Body> + Send + Sync + 'static,
    {
        let record = RecordedRequest {
            method,
            uri,
            headers,
            body: body.to_vec(),
        };
        let _ = state.tx.send(record);
        (state.response_factory)()
    }

    async fn spawn_stub_server<F>(
        response_factory: F,
    ) -> (
        SocketAddr,
        UnboundedReceiver<RecordedRequest>,
        JoinHandle<()>,
    )
    where
        F: Fn() -> Response<Body> + Send + Sync + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = unbounded_channel();
        let state = StubState {
            tx,
            response_factory: Arc::new(response_factory),
        };

        let app = Router::new()
            .route("/mail/send", post(stub_handler::<F>))
            .with_state(state);

        let server = axum::serve(listener, app.into_make_service());
        let handle = tokio::spawn(async move {
            if let Err(err) = server.await {
                eprintln!("stub server exited with error: {err}");
            }
        });
        (addr, rx, handle)
    }

    #[tokio::test]
    async fn sendgrid_plain_email_succeeds() {
        let (addr, mut rx, handle) = spawn_stub_server(|| {
            Response::builder()
                .status(StatusCode::ACCEPTED)
                .header("x-message-id", "abc123")
                .body(Body::from(Vec::<u8>::new()))
                .unwrap()
        })
        .await;

        let _guard = EnvGuard::set("SENDGRID_API_BASE", format!("http://{}", addr));
        let state = test_state();
        let node = Node {
            id: "action-1".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "service": "SendGrid",
                    "apiKey": "SG.fake-key",
                    "from": "sender@example.com",
                    "to": "user@example.com",
                    "subject": "Hello {{user.name}}",
                    "body": "Body for {{user.name}}"
                }
            }),
        };

        let context = json!({ "user": { "name": "Alice" } });
        let (output, next) = execute_email(&node, &context, &state)
            .await
            .expect("sendgrid email should succeed");

        assert_eq!(next, None);
        assert_eq!(output["sent"], true);
        assert_eq!(output["service"], "SendGrid");
        assert_eq!(output["status"], 202);
        assert_eq!(output["message_id"], "abc123");

        let req = rx.recv().await.expect("request should be recorded");
        handle.abort();

        assert_eq!(
            req.headers
                .get("authorization")
                .and_then(|v| v.to_str().ok()),
            Some("Bearer SG.fake-key"),
        );
        let body: Value = serde_json::from_slice(&req.body).expect("valid json body");
        assert_eq!(body["from"]["email"], "sender@example.com");
        assert_eq!(body["personalizations"][0]["subject"], "Hello Alice");
        assert_eq!(body["content"][0]["value"], "Body for Alice");
    }

    #[tokio::test]
    async fn sendgrid_template_email_includes_dynamic_data() {
        let (addr, mut rx, handle) = spawn_stub_server(|| {
            Response::builder()
                .status(StatusCode::ACCEPTED)
                .body(Body::from(Vec::<u8>::new()))
                .unwrap()
        })
        .await;

        let _guard = EnvGuard::set("SENDGRID_API_BASE", format!("http://{}", addr));
        let state = test_state();
        let node = Node {
            id: "action-2".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "service": "SendGrid",
                    "apiKey": "SG.template",
                    "from": "sender@example.com",
                    "to": "user1@example.com, user2@example.com",
                    "templateId": "tmpl-123",
                    "substitutions": [
                        { "key": "firstName", "value": "{{ user.first }}" },
                        { "key": "account", "value": "{{ account.id }}" }
                    ]
                }
            }),
        };

        let context = json!({
            "user": { "first": "Bob" },
            "account": { "id": "A-100" }
        });

        let (output, _) = execute_email(&node, &context, &state)
            .await
            .expect("sendgrid template email should succeed");

        assert_eq!(output["sent"], true);
        assert_eq!(output["service"], "SendGrid");
        assert_eq!(output["status"], 202);

        let req = rx.recv().await.expect("request should be recorded");
        handle.abort();

        let body: Value = serde_json::from_slice(&req.body).expect("valid json body");
        assert_eq!(body["template_id"], "tmpl-123");
        assert!(body.get("content").is_none());
        let personalization = &body["personalizations"][0];
        let dynamic = personalization["dynamic_template_data"]
            .as_object()
            .unwrap();
        assert_eq!(dynamic.get("firstName").unwrap(), "Bob");
        assert_eq!(dynamic.get("account").unwrap(), "A-100");
        let to_emails = personalization["to"].as_array().unwrap();
        assert_eq!(to_emails.len(), 2);
    }

    #[tokio::test]
    async fn sendgrid_error_response_is_propagated() {
        let error_body = Arc::new(json!({ "errors": [{ "message": "Bad request" }] }).to_string());
        let (addr, mut rx, handle) = spawn_stub_server({
            let error_body = error_body.clone();
            move || {
                Response::builder()
                    .status(StatusCode::BAD_REQUEST)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(error_body.as_str().to_owned()))
                    .unwrap()
            }
        })
        .await;

        let _guard = EnvGuard::set("SENDGRID_API_BASE", format!("http://{}", addr));
        let state = test_state();
        let node = Node {
            id: "action-3".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "service": "SendGrid",
                    "apiKey": "SG.error",
                    "from": "sender@example.com",
                    "to": "user@example.com",
                    "subject": "Hi",
                    "body": "Body"
                }
            }),
        };

        let err = execute_email(&node, &Value::Null, &state)
            .await
            .expect_err("sendgrid call should fail");
        assert!(err.contains("status 400"));
        assert!(err.contains("Bad request"));

        let _ = rx.recv().await;
        handle.abort();
    }

    #[tokio::test]
    async fn sendgrid_duplicate_recipients_return_error() {
        let state = test_state();
        let node = Node {
            id: "action-4".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "service": "SendGrid",
                    "apiKey": "SG.key",
                    "from": "sender@example.com",
                    "to": "user@example.com, user@example.com",
                    "subject": "Hi",
                    "body": "Body"
                }
            }),
        };

        let err = execute_email(&node, &Value::Null, &state)
            .await
            .expect_err("duplicate recipients should fail");
        assert!(err.contains("Duplicate recipient email"));
    }
}
