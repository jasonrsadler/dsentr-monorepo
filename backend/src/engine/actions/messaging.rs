use crate::engine::graph::Node;
use crate::engine::templating::templ_str;
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Url,
};
use serde_json::{json, Map, Value};

pub(crate) async fn execute_messaging(
    node: &Node,
    context: &Value,
) -> Result<(Value, Option<String>), String> {
    let params = node.data.get("params").cloned().unwrap_or(Value::Null);
    let platform_raw = params
        .get("platform")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Platform is required".to_string())?;

    let normalized = platform_raw
        .to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '_')
        .collect::<String>();

    match normalized.as_str() {
        "slack" => send_slack(&params, context).await,
        "teams" => send_teams(node, &params, context).await,
        "googlechat" | "google" | "googlechatapp" => send_google_chat(&params, context).await,
        other => Err(format!("Unsupported messaging platform: {}", other)),
    }
}

fn extract_required_str<'a>(params: &'a Value, key: &str, field: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("{} is required", field))
}

async fn send_slack(params: &Value, context: &Value) -> Result<(Value, Option<String>), String> {
    let token = extract_required_str(params, "token", "Slack token")?;
    let channel_raw = extract_required_str(params, "channel", "Slack channel")?;
    let message_raw = extract_required_str(params, "message", "Message")?;

    let channel = templ_str(channel_raw, context);
    if channel.trim().is_empty() {
        return Err("Slack channel is required".to_string());
    }

    let message = templ_str(message_raw, context);
    if message.trim().is_empty() {
        return Err("Message is required".to_string());
    }

    let base = std::env::var("SLACK_API_BASE")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "https://slack.com/api".to_string());
    let url = format!("{}/chat.postMessage", base.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .bearer_auth(token)
        .json(&json!({ "channel": channel, "text": message }))
        .send()
        .await
        .map_err(|e| format!("Slack request failed: {e}"))?;

    let status = response.status();
    let body_text = response
        .text()
        .await
        .map_err(|e| format!("Slack response read failed: {e}"))?;
    let parsed: Option<Value> = serde_json::from_str(&body_text).ok();

    let is_ok = parsed
        .as_ref()
        .and_then(|v| v.get("ok"))
        .and_then(|v| v.as_bool())
        .unwrap_or_else(|| status.is_success());

    if !status.is_success() || !is_ok {
        let detail = parsed
            .as_ref()
            .and_then(|v| v.get("error"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                let trimmed = body_text.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            })
            .unwrap_or_else(|| "Unknown Slack API error".to_string());
        return Err(format!(
            "Slack API error (status {}): {}",
            status.as_u16(),
            detail
        ));
    }

    let mut output = json!({
        "sent": true,
        "service": "Slack",
        "platform": "Slack",
        "status": status.as_u16(),
    });

    if let Some(ts) = parsed
        .as_ref()
        .and_then(|v| v.get("ts"))
        .and_then(|v| v.as_str())
    {
        output["messageTs"] = Value::String(ts.to_string());
    }

    if let Some(channel_id) = parsed
        .as_ref()
        .and_then(|v| v.get("channel"))
        .and_then(|v| v.as_str())
    {
        output["channelId"] = Value::String(channel_id.to_string());
    }

    Ok((output, None))
}

async fn send_teams(
    node: &Node,
    params: &Value,
    context: &Value,
) -> Result<(Value, Option<String>), String> {
    let sanitized = sanitize_teams_params(params);

    let delivery_method = sanitized
        .get("deliveryMethod")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Incoming Webhook".to_string());

    match normalize_identifier(&delivery_method).as_str() {
        "incomingwebhook" => send_teams_incoming_webhook(&sanitized, context).await,
        _ => Err(format!(
            "Teams delivery method '{}' is not supported yet",
            delivery_method
        )),
    }
}

async fn send_google_chat(
    params: &Value,
    context: &Value,
) -> Result<(Value, Option<String>), String> {
    send_webhook_message(params, context, "Google Chat").await
}

async fn send_webhook_message(
    params: &Value,
    context: &Value,
    service: &str,
) -> Result<(Value, Option<String>), String> {
    let webhook_raw = extract_required_str(params, "webhookUrl", "Webhook URL")?;
    let message_raw = extract_required_str(params, "message", "Message")?;

    let message = templ_str(message_raw, context);
    if message.trim().is_empty() {
        return Err("Message is required".to_string());
    }

    post_webhook_payload(webhook_raw, json!({ "text": message }), service, None).await
}

fn normalize_identifier(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '_' && *c != '/')
        .flat_map(|c| c.to_lowercase())
        .collect()
}

async fn send_teams_incoming_webhook(
    params: &Value,
    context: &Value,
) -> Result<(Value, Option<String>), String> {
    let webhook_type = params
        .get("webhookType")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Connector".to_string());

    match normalize_identifier(&webhook_type).as_str() {
        "connector" => send_teams_connector_webhook(params, context).await,
        "workflowpowerautomate" | "workflow" | "powerautomate" => {
            send_teams_workflow_webhook(params, context).await
        }
        _ => Err(format!(
            "Teams webhook type '{}' is not supported",
            webhook_type
        )),
    }
}

fn extract_optional_templated_string(params: &Value, key: &str, context: &Value) -> Option<String> {
    params
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| templ_str(s, context))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

async fn send_teams_connector_webhook(
    params: &Value,
    context: &Value,
) -> Result<(Value, Option<String>), String> {
    let webhook_raw = extract_required_str(params, "webhookUrl", "Webhook URL")?;
    let message_raw = extract_required_str(params, "message", "Message")?;

    let message = templ_str(message_raw, context);
    if message.trim().is_empty() {
        return Err("Message is required".to_string());
    }

    let title = extract_optional_templated_string(params, "title", context);
    let summary = extract_optional_templated_string(params, "summary", context)
        .unwrap_or_else(|| message.clone());

    let theme_color = extract_optional_templated_string(params, "themeColor", context)
        .map(|color| color.trim_start_matches('#').to_string())
        .map(|color| color.to_uppercase());

    if let Some(ref color) = theme_color {
        let is_valid = color.len() == 6 && color.chars().all(|c| c.is_ascii_hexdigit());
        if !is_valid {
            return Err("Theme color must be a 6-digit hex value".to_string());
        }
    }

    let mut payload = json!({
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "summary": summary,
        "text": message,
    });

    if let Some(title) = title {
        payload["title"] = Value::String(title);
    }

    if let Some(color) = theme_color {
        payload["themeColor"] = Value::String(color);
    }

    post_webhook_payload(webhook_raw, payload, "Teams", None).await
}

async fn send_teams_workflow_webhook(
    params: &Value,
    context: &Value,
) -> Result<(Value, Option<String>), String> {
    let workflow_option = params
        .get("workflowOption")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("Basic (Raw JSON)");

    let workflow_option_normalized = normalize_identifier(workflow_option);

    let webhook_url_raw = extract_required_str(params, "webhookUrl", "Webhook URL")?;
    let webhook_url = webhook_url_raw.trim();
    if webhook_url.is_empty() {
        return Err("Webhook URL is required".to_string());
    }

    let raw_payload = extract_required_str(params, "workflowRawJson", "Raw JSON payload")?;
    let templated = templ_str(raw_payload, context);
    if templated.trim().is_empty() {
        return Err("Raw JSON payload is required".to_string());
    }
    let payload = serde_json::from_str::<Value>(&templated)
        .map_err(|e| format!("Raw JSON payload is invalid: {e}"))?;

    let mut headers = HeaderMap::new();

    match workflow_option_normalized.as_str() {
        "headersecretauth" => {
            let header_name_raw =
                extract_required_str(params, "workflowHeaderName", "Header name")?;
            let header_value_raw =
                extract_required_str(params, "workflowHeaderSecret", "Header secret")?;

            let header_name = templ_str(header_name_raw, context);
            let trimmed_name = header_name.trim();
            if trimmed_name.is_empty() {
                return Err("Header name is required".to_string());
            }

            let header_name = HeaderName::from_bytes(trimmed_name.as_bytes())
                .map_err(|_| "Header name is invalid".to_string())?;

            let header_value = templ_str(header_value_raw, context);
            if header_value.trim().is_empty() {
                return Err("Header secret is required".to_string());
            }

            let header_value = HeaderValue::from_str(header_value.as_str())
                .map_err(|_| "Header secret contains invalid characters".to_string())?;

            headers.insert(header_name, header_value);
        }
        _ => {}
    }

    let headers = if headers.is_empty() {
        None
    } else {
        Some(headers)
    };

    post_webhook_payload(webhook_url, payload, "Teams", headers).await
}

fn optional_string(params: &Value, key: &str) -> Option<String> {
    params
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .and_then(|s| if s.trim().is_empty() { None } else { Some(s) })
}

fn sanitize_teams_params(params: &Value) -> Value {
    let mut map = Map::new();

    let delivery_method = params
        .get("deliveryMethod")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("Incoming Webhook");

    map.insert(
        "deliveryMethod".to_string(),
        Value::String(delivery_method.to_string()),
    );

    let normalized_delivery = normalize_identifier(delivery_method);

    if normalized_delivery != "incomingwebhook" {
        return Value::Object(map);
    }

    let webhook_type = params
        .get("webhookType")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("Connector");

    map.insert(
        "webhookType".to_string(),
        Value::String(webhook_type.to_string()),
    );

    let webhook_url = optional_string(params, "webhookUrl");

    match normalize_identifier(webhook_type).as_str() {
        "connector" => {
            if let Some(url) = webhook_url {
                map.insert("webhookUrl".to_string(), Value::String(url));
            }
            if let Some(title) = optional_string(params, "title") {
                map.insert("title".to_string(), Value::String(title));
            }
            if let Some(summary) = optional_string(params, "summary") {
                map.insert("summary".to_string(), Value::String(summary));
            }
            if let Some(theme_color) = optional_string(params, "themeColor") {
                map.insert("themeColor".to_string(), Value::String(theme_color));
            }
            if let Some(message) = optional_string(params, "message") {
                map.insert("message".to_string(), Value::String(message));
            }
        }
        "workflowpowerautomate" | "workflow" | "powerautomate" => {
            let requested_option = params
                .get("workflowOption")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .unwrap_or("Basic (Raw JSON)");

            let normalized_option = normalize_identifier(requested_option);
            let coerced_option = if normalized_option == "headersecretauth" {
                "Header Secret Auth"
            } else {
                "Basic (Raw JSON)"
            };

            map.insert(
                "workflowOption".to_string(),
                Value::String(coerced_option.to_string()),
            );

            if let Some(raw) = optional_string(params, "workflowRawJson") {
                map.insert("workflowRawJson".to_string(), Value::String(raw));
            }

            if let Some(url) = webhook_url.clone() {
                map.insert("webhookUrl".to_string(), Value::String(url));
            }

            if normalized_option == "headersecretauth" {
                if let Some(name) = optional_string(params, "workflowHeaderName") {
                    map.insert("workflowHeaderName".to_string(), Value::String(name));
                }
                if let Some(secret) = optional_string(params, "workflowHeaderSecret") {
                    map.insert("workflowHeaderSecret".to_string(), Value::String(secret));
                }
            }
        }
        _ => {}
    }

    Value::Object(map)
}

async fn post_webhook_payload(
    webhook_raw: &str,
    payload: Value,
    service: &str,
    extra_headers: Option<HeaderMap>,
) -> Result<(Value, Option<String>), String> {
    let parsed_url =
        Url::parse(webhook_raw).map_err(|_| format!("Invalid webhook URL for {}", service))?;
    match parsed_url.scheme() {
        "http" | "https" => {}
        _ => return Err(format!("Webhook URL for {} must be HTTP or HTTPS", service)),
    }

    let client = reqwest::Client::new();
    let mut request = client.post(parsed_url).json(&payload);

    if let Some(headers) = extra_headers {
        request = request.headers(headers);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("{} webhook request failed: {e}", service))?;

    let status = response.status();
    let body_text = response
        .text()
        .await
        .map_err(|e| format!("{} webhook response read failed: {e}", service))?;

    if !status.is_success() {
        let detail = body_text.trim();
        let message = if detail.is_empty() {
            format!("{} webhook returned status {}", service, status.as_u16())
        } else {
            format!(
                "{} webhook returned status {}: {}",
                service,
                status.as_u16(),
                detail
            )
        };
        return Err(message);
    }

    Ok((
        json!({
            "sent": true,
            "service": service,
            "platform": service,
            "status": status.as_u16(),
        }),
        None,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        extract::State,
        http::{header, Request, Response, StatusCode},
        routing::post,
        Router,
    };
    use serde_json::{json, Value};
    use std::sync::Arc;
    use tokio::{
        net::TcpListener,
        sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender},
        task::JoinHandle,
    };

    use crate::engine::graph::Node;

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

    #[derive(Clone, Debug)]
    struct RecordedRequest {
        method: String,
        uri: String,
        headers: Vec<(String, String)>,
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
        request: Request<Body>,
    ) -> Response<Body>
    where
        F: Fn() -> Response<Body> + Send + Sync + 'static,
    {
        let (parts, body) = request.into_parts();
        let bytes = to_bytes(body, 1024 * 1024).await.unwrap_or_default();
        let headers = parts
            .headers
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or_default().to_string()))
            .collect();
        let record = RecordedRequest {
            method: parts.method.to_string(),
            uri: parts.uri.to_string(),
            headers,
            body: bytes.to_vec(),
        };
        let _ = state.tx.send(record);
        (state.response_factory)()
    }

    async fn spawn_stub_server<F>(
        response_factory: F,
    ) -> (
        std::net::SocketAddr,
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
            .route("/*path", post(stub_handler::<F>))
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
    async fn slack_message_succeeds() {
        let (addr, mut rx, handle) = spawn_stub_server(|| {
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"ok":true,"ts":"123.456","channel":"C123"}"#))
                .unwrap()
        })
        .await;

        let _guard = EnvGuard::set("SLACK_API_BASE", format!("http://{}/api", addr));

        let node = Node {
            id: "action-1".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "platform": "Slack",
                    "channel": "#alerts",
                    "message": "Hello {{ user.name }}",
                    "token": "xoxb-test"
                }
            }),
        };

        let context = json!({ "user": { "name": "Alice" } });

        let (output, next) = execute_messaging(&node, &context)
            .await
            .expect("slack message should succeed");

        assert!(next.is_none());
        assert_eq!(output["sent"], true);
        assert_eq!(output["service"], "Slack");
        assert_eq!(output["status"], 200);
        assert_eq!(output["messageTs"], "123.456");
        assert_eq!(output["channelId"], "C123");

        let req = rx.recv().await.expect("request should be recorded");
        handle.abort();

        assert_eq!(req.method, "POST");
        assert!(req.uri.ends_with("/api/chat.postMessage"));
        let auth_header = req
            .headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("authorization"))
            .map(|(_, v)| v.clone())
            .expect("authorization header");
        assert_eq!(auth_header, "Bearer xoxb-test");

        let body: Value = serde_json::from_slice(&req.body).expect("json body");
        assert_eq!(body["channel"], "#alerts");
        assert_eq!(body["text"], "Hello Alice");
    }

    #[tokio::test]
    async fn slack_error_is_reported() {
        let (addr, _rx, handle) = spawn_stub_server(|| {
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"ok":false,"error":"channel_not_found"}"#))
                .unwrap()
        })
        .await;

        let _guard = EnvGuard::set("SLACK_API_BASE", format!("http://{}/api", addr));

        let node = Node {
            id: "action-2".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "platform": "Slack",
                    "channel": "#alerts",
                    "message": "Hi",
                    "token": "xoxb-test"
                }
            }),
        };

        let err = execute_messaging(&node, &Value::Null)
            .await
            .expect_err("slack call should fail");
        handle.abort();
        assert!(err.contains("channel_not_found"));
    }

    #[tokio::test]
    async fn slack_requires_token() {
        let node = Node {
            id: "action-3".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "platform": "Slack",
                    "channel": "#alerts",
                    "message": "Hello"
                }
            }),
        };

        let err = execute_messaging(&node, &Value::Null)
            .await
            .expect_err("missing token should fail");
        assert!(err.contains("Slack token"));
    }

    #[tokio::test]
    async fn teams_webhook_succeeds() {
        let (addr, mut rx, handle) = spawn_stub_server(|| {
            Response::builder()
                .status(StatusCode::OK)
                .body(Body::empty())
                .unwrap()
        })
        .await;

        let node = Node {
            id: "action-4".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "platform": "Teams",
                    "deliveryMethod": "Incoming Webhook",
                    "webhookType": "Connector",
                    "webhookUrl": format!("http://{addr}/teams"),
                    "message": "Alert: {{ incident.id }}",
                    "title": "Incident {{ incident.id }}",
                    "summary": "Summary for {{ incident.id }}",
                    "themeColor": "#00ff99"
                }
            }),
        };

        let context = json!({ "incident": { "id": "INC-1" } });

        let (output, _) = execute_messaging(&node, &context)
            .await
            .expect("teams call succeeds");

        assert_eq!(output["sent"], true);
        assert_eq!(output["service"], "Teams");
        assert_eq!(output["status"], 200);

        let req = rx.recv().await.expect("recorded request");
        handle.abort();
        let body: Value = serde_json::from_slice(&req.body).expect("json body");
        assert_eq!(body["@type"], "MessageCard");
        assert_eq!(body["text"], "Alert: INC-1");
        assert_eq!(body["title"], "Incident INC-1");
        assert_eq!(body["summary"], "Summary for INC-1");
        assert_eq!(body["themeColor"], "00FF99");
    }

    #[tokio::test]
    async fn teams_webhook_failure_propagates() {
        let (addr, _rx, handle) = spawn_stub_server(|| {
            Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("bad payload"))
                .unwrap()
        })
        .await;

        let node = Node {
            id: "action-5".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "platform": "Teams",
                    "deliveryMethod": "Incoming Webhook",
                    "webhookType": "Connector",
                    "webhookUrl": format!("http://{addr}/teams"),
                    "message": "Alert"
                }
            }),
        };

        let err = execute_messaging(&node, &Value::Null)
            .await
            .expect_err("teams should fail");
        handle.abort();
        assert!(err.contains("bad payload"));
        assert!(err.contains("400"));
    }

    #[tokio::test]
    async fn teams_workflow_webhook_ignores_legacy_fields() {
        let (addr, mut rx, handle) = spawn_stub_server(|| {
            Response::builder()
                .status(StatusCode::OK)
                .body(Body::empty())
                .unwrap()
        })
        .await;

        let node = Node {
            id: "action-7".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "platform": "Teams",
                    "deliveryMethod": "Incoming Webhook",
                    "webhookType": "Workflow/Power Automate",
                    "webhookUrl": format!("http://{addr}/workflow"),
                    "message": "Workflow alert",
                    "summary": "Workflow summary",
                    "cardJson": "{\"type\":\"AdaptiveCard\"}",
                    "workflowOption": "Basic (Raw JSON)",
                    "workflowRawJson": r#"{
                        "type": "message",
                        "text": "payload text",
                        "summary": "payload summary"
                    }"#
                }
            }),
        };

        let (output, _) = execute_messaging(&node, &Value::Null)
            .await
            .expect("workflow webhook succeeds");

        assert_eq!(output["service"], "Teams");
        assert_eq!(output["status"], 200);

        let req = rx.recv().await.expect("workflow request recorded");
        handle.abort();
        let body: Value = serde_json::from_slice(&req.body).expect("json body");
        assert_eq!(body["type"], "message");
        assert_eq!(body["text"], "payload text");
        assert_eq!(body["summary"], "payload summary");
        assert!(body.get("attachments").is_none());
    }

    #[tokio::test]
    async fn teams_workflow_webhook_sends_raw_json_payload() {
        let (addr, mut rx, handle) = spawn_stub_server(|| {
            Response::builder()
                .status(StatusCode::OK)
                .body(Body::empty())
                .unwrap()
        })
        .await;

        let node = Node {
            id: "action-8".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "platform": "Teams",
                    "deliveryMethod": "Incoming Webhook",
                    "webhookType": "Workflow/Power Automate",
                    "webhookUrl": format!("http://{addr}/workflow"),
                    "workflowOption": "Basic (Raw JSON)",
                    "workflowRawJson": r#"{
                        "type": "message",
                        "text": "Hello {{ user }}",
                        "summary": "raw"
                    }"#
                }
            }),
        };

        let context = json!({ "user": "Charlie" });

        let (output, _) = execute_messaging(&node, &context)
            .await
            .expect("raw json workflow succeeds");

        assert_eq!(output["service"], "Teams");
        assert_eq!(output["status"], 200);

        let req = rx.recv().await.expect("workflow request recorded");
        handle.abort();
        let body: Value = serde_json::from_slice(&req.body).expect("json body");
        assert_eq!(body["type"], "message");
        assert_eq!(body["text"], "Hello Charlie");
        assert_eq!(body["summary"], "raw");
    }

    #[tokio::test]
    async fn teams_workflow_webhook_attaches_header_secret() {
        let (addr, mut rx, handle) = spawn_stub_server(|| {
            Response::builder()
                .status(StatusCode::OK)
                .body(Body::empty())
                .unwrap()
        })
        .await;

        let node = Node {
            id: "action-9".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "platform": "Teams",
                    "deliveryMethod": "Incoming Webhook",
                    "webhookType": "Workflow/Power Automate",
                    "webhookUrl": format!("http://{addr}/workflow"),
                    "workflowOption": "Header Secret Auth",
                    "workflowRawJson": r#"{
                        "type": "message",
                        "text": "secret"
                    }"#,
                    "workflowHeaderName": "X-Workflow-Secret",
                    "workflowHeaderSecret": "super-secret"
                }
            }),
        };

        let (output, _) = execute_messaging(&node, &Value::Null)
            .await
            .expect("header secret workflow succeeds");

        assert_eq!(output["status"], 200);

        let req = rx.recv().await.expect("workflow request recorded");
        handle.abort();

        let header = req
            .headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("X-Workflow-Secret"))
            .map(|(_, value)| value.clone())
            .expect("header should exist");
        assert_eq!(header, "super-secret");
    }

    #[test]
    fn sanitize_teams_params_drops_oauth_fields() {
        let params = json!({
            "deliveryMethod": "Incoming Webhook",
            "webhookType": "Workflow/Power Automate",
            "webhookUrl": "https://example.com/workflow",
            "workflowOption": "Basic (Raw JSON)",
            "workflowRawJson": "{\"type\":\"message\"}",
            "workflowOAuthUrl": "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
            "workflowOAuthClientId": "client",
            "workflowOAuthClientSecret": "secret",
            "workflowOAuthScope": "scope",
            "workflowOAuthTenantId": "tenant"
        });

        let sanitized = sanitize_teams_params(&params);
        let map = sanitized
            .as_object()
            .expect("teams params should sanitize to an object");

        assert_eq!(
            map.get("workflowOption")
                .and_then(|v| v.as_str())
                .unwrap_or_default(),
            "Basic (Raw JSON)"
        );
        assert!(map.get("workflowRawJson").is_some());
        assert!(map.get("workflowOAuthUrl").is_none());
        assert!(map.get("workflowOAuthClientId").is_none());
        assert!(map.get("workflowOAuthClientSecret").is_none());
        assert!(map.get("workflowOAuthScope").is_none());
        assert!(map.get("workflowOAuthTenantId").is_none());
    }

    #[tokio::test]
    async fn google_chat_succeeds() {
        let (addr, mut rx, handle) = spawn_stub_server(|| {
            Response::builder()
                .status(StatusCode::OK)
                .body(Body::empty())
                .unwrap()
        })
        .await;

        let node = Node {
            id: "action-6".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "platform": "Google Chat",
                    "webhookUrl": format!("http://{addr}/chat"),
                    "message": "Hello {{ team }}"
                }
            }),
        };

        let context = json!({ "team": "Integrations" });

        let (output, _) = execute_messaging(&node, &context)
            .await
            .expect("chat call succeeds");

        assert_eq!(output["service"], "Google Chat");
        assert_eq!(output["status"], 200);

        let req = rx.recv().await.expect("request recorded");
        handle.abort();
        let body: Value = serde_json::from_slice(&req.body).expect("json body");
        assert_eq!(body["text"], "Hello Integrations");
    }
}
