use reqwest::Url;
use serde_json::{json, Value};

use crate::engine::graph::Node;
use crate::engine::templating::templ_str;

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
        "teams" => send_teams(&params, context).await,
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

async fn send_teams(params: &Value, context: &Value) -> Result<(Value, Option<String>), String> {
    send_webhook_message(params, context, "Teams").await
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

    let parsed_url =
        Url::parse(webhook_raw).map_err(|_| format!("Invalid webhook URL for {}", service))?;
    match parsed_url.scheme() {
        "http" | "https" => {}
        _ => return Err(format!("Webhook URL for {} must be HTTP or HTTPS", service)),
    }

    let client = reqwest::Client::new();
    let response = client
        .post(parsed_url)
        .json(&json!({ "text": message }))
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
                    "webhookUrl": format!("http://{addr}/teams"),
                    "message": "Alert: {{ incident.id }}"
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
        assert_eq!(body["text"], "Alert: INC-1");
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
