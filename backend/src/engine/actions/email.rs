use std::collections::HashSet;

use serde_json::{json, Value};

use crate::engine::graph::Node;
use crate::engine::templating::templ_str;
use crate::state::AppState;

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

pub(crate) async fn execute_email(
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
        "mailgun" => {
            let domain = params
                .get("domain")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "Mailgun domain is required".to_string())?
                .to_string();

            let api_key = params
                .get("apiKey")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "Mailgun API key is required".to_string())?
                .to_string();

            let region = params
                .get("region")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "Mailgun region is required".to_string())?;

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

            let template = params
                .get("template")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());

            if template.is_none() {
                if subject.trim().is_empty() {
                    return Err(
                        "Subject is required for Mailgun emails without a template".to_string()
                    );
                }
                if body.trim().is_empty() {
                    return Err(
                        "Message body is required for Mailgun emails without a template"
                            .to_string(),
                    );
                }
            }

            let mut form_fields: Vec<(String, String)> = Vec::new();
            form_fields.push(("from".to_string(), from_email.to_string()));
            form_fields.push(("to".to_string(), recipients.join(", ")));

            if let Some(tpl) = template {
                form_fields.push(("template".to_string(), tpl));
                if let Some(vars) = params.get("variables").and_then(|v| v.as_array()) {
                    let mut resolved = serde_json::Map::new();
                    for pair in vars {
                        let Some(key) = pair.get("key").and_then(|v| v.as_str()).map(|s| s.trim())
                        else {
                            continue;
                        };
                        if key.is_empty() {
                            continue;
                        }
                        let value_raw = pair.get("value").and_then(|v| v.as_str()).unwrap_or("");
                        let templated = templ_str(value_raw, context);
                        resolved.insert(key.to_string(), Value::String(templated));
                    }
                    if !resolved.is_empty() {
                        let json_value = Value::Object(resolved);
                        if let Ok(serialized) = serde_json::to_string(&json_value) {
                            form_fields.push(("h:X-Mailgun-Variables".to_string(), serialized));
                        }
                    }
                }
            } else {
                form_fields.push(("subject".to_string(), subject));
                form_fields.push(("text".to_string(), body.clone()));
            }

            let default_base = if region.to_lowercase().contains("eu") {
                "https://api.eu.mailgun.net".to_string()
            } else {
                "https://api.mailgun.net".to_string()
            };

            let base = std::env::var("MAILGUN_API_BASE")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .unwrap_or(default_base);

            let url = format!(
                "{}/v3/{}/messages",
                base.trim_end_matches('/'),
                domain.trim_matches('/')
            );

            let client = reqwest::Client::new();
            let resp = client
                .post(url)
                .basic_auth("api", Some(api_key))
                .form(&form_fields)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            let status = resp.status();
            let headers = resp.headers().clone();
            let body_text = resp.text().await.map_err(|e| e.to_string())?;

            if !status.is_success() {
                return Err(format!(
                    "Mailgun request failed (status {}): {}",
                    status.as_u16(),
                    body_text
                ));
            }

            let mut message_id = headers
                .get("message-id")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            if message_id.is_none() {
                if let Ok(json) = serde_json::from_str::<Value>(&body_text) {
                    message_id = json
                        .get("id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }

            Ok((
                json!({
                    "sent": true,
                    "service": "Mailgun",
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
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;
    use serde_json::{json, Value};
    use std::collections::HashMap;
    use std::net::SocketAddr;
    use std::sync::Arc;
    use tokio::net::TcpListener;
    use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
    use tokio::task::JoinHandle;
    use urlencoding::decode;

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

    async fn spawn_mailgun_stub_server<F>(
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
            .route("/v3/:domain/messages", post(stub_handler::<F>))
            .with_state(state);

        let server = axum::serve(listener, app.into_make_service());
        let handle = tokio::spawn(async move {
            if let Err(err) = server.await {
                eprintln!("mailgun stub server exited with error: {err}");
            }
        });

        (addr, rx, handle)
    }

    fn parse_form_body(body: &[u8]) -> HashMap<String, Vec<String>> {
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        let Ok(as_str) = String::from_utf8(body.to_vec()) else {
            return map;
        };

        for pair in as_str.split('&') {
            if pair.is_empty() {
                continue;
            }
            let mut parts = pair.splitn(2, '=');
            let key_enc = parts.next().unwrap_or("");
            let value_enc = parts.next().unwrap_or("");
            let key = decode(key_enc)
                .map(|v| v.into_owned())
                .unwrap_or_else(|_| key_enc.to_string());
            let value = decode(value_enc)
                .map(|v| v.into_owned())
                .unwrap_or_else(|_| value_enc.to_string());
            map.entry(key).or_default().push(value);
        }

        map
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

    #[tokio::test]
    async fn mailgun_plain_email_succeeds() {
        let (addr, mut rx, handle) = spawn_mailgun_stub_server(|| {
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"id":"<2024.mailgun>"}"#))
                .unwrap()
        })
        .await;

        let _guard = EnvGuard::set("MAILGUN_API_BASE", format!("http://{}", addr));
        let state = test_state();
        let node = Node {
            id: "action-mailgun-1".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "service": "Mailgun",
                    "domain": "mg.example.com",
                    "apiKey": "key-123",
                    "region": "US (api.mailgun.net)",
                    "from": "sender@example.com",
                    "to": "user@example.com",
                    "subject": "Hi",
                    "body": "Body"
                }
            }),
        };

        let (output, next) = execute_email(&node, &Value::Null, &state)
            .await
            .expect("mailgun email should succeed");

        assert_eq!(output["service"], "Mailgun");
        assert_eq!(output["status"], 200);
        assert_eq!(next, Some("<2024.mailgun>".to_string()));

        let req = rx.recv().await.expect("request should be recorded");
        handle.abort();

        let auth_header = req
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .expect("auth header present");
        assert!(auth_header.starts_with("Basic "));
        let token = &auth_header[6..];
        let decoded = BASE64
            .decode(token.as_bytes())
            .expect("valid base64 auth header");
        assert_eq!(String::from_utf8_lossy(&decoded), "api:key-123");

        let form = parse_form_body(&req.body);
        assert_eq!(
            form.get("subject").and_then(|v| v.first()),
            Some(&"Hi".to_string())
        );
        assert_eq!(
            form.get("text").and_then(|v| v.first()),
            Some(&"Body".to_string())
        );
    }

    #[tokio::test]
    async fn mailgun_template_email_includes_variables() {
        let (addr, mut rx, handle) = spawn_mailgun_stub_server(|| {
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"id":"<queued>"}"#))
                .unwrap()
        })
        .await;

        let _guard = EnvGuard::set("MAILGUN_API_BASE", format!("http://{}", addr));
        let state = test_state();
        let node = Node {
            id: "action-mailgun-2".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "service": "Mailgun",
                    "domain": "mg.example.com",
                    "apiKey": "key-456",
                    "region": "EU (api.eu.mailgun.net)",
                    "from": "sender@example.com",
                    "to": "user1@example.com, user2@example.com",
                    "template": "welcome",
                    "variables": [
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

        let (output, next) = execute_email(&node, &context, &state)
            .await
            .expect("mailgun template email should succeed");

        assert_eq!(output["service"], "Mailgun");
        assert_eq!(output["status"], 200);
        assert_eq!(next, Some("<queued>".to_string()));

        let req = rx.recv().await.expect("request should be recorded");
        handle.abort();

        let form = parse_form_body(&req.body);
        assert_eq!(
            form.get("template").and_then(|v| v.first()),
            Some(&"welcome".to_string())
        );
        assert!(form.get("subject").is_none());
        let vars_json = form
            .get("h:X-Mailgun-Variables")
            .and_then(|v| v.first())
            .expect("variables included");
        let vars: Value = serde_json::from_str(vars_json).expect("valid variables json");
        assert_eq!(vars["firstName"], "Bob");
        assert_eq!(vars["account"], "A-100");
        let to_values = form.get("to").and_then(|v| v.first()).unwrap();
        assert!(to_values.contains("user1@example.com"));
        assert!(to_values.contains("user2@example.com"));
    }

    #[tokio::test]
    async fn mailgun_error_response_is_propagated() {
        let error_body = Arc::new(json!({ "message": "Invalid domain" }).to_string());
        let (addr, mut rx, handle) = spawn_mailgun_stub_server({
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

        let _guard = EnvGuard::set("MAILGUN_API_BASE", format!("http://{}", addr));
        let state = test_state();
        let node = Node {
            id: "action-mailgun-3".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "service": "Mailgun",
                    "domain": "mg.example.com",
                    "apiKey": "key-error",
                    "region": "US (api.mailgun.net)",
                    "from": "sender@example.com",
                    "to": "user@example.com",
                    "subject": "Hi",
                    "body": "Body"
                }
            }),
        };

        let err = execute_email(&node, &Value::Null, &state)
            .await
            .expect_err("mailgun call should fail");
        assert!(err.contains("status 400"));
        assert!(err.contains("Invalid domain"));

        let _ = rx.recv().await;
        handle.abort();
    }

    #[tokio::test]
    async fn mailgun_missing_subject_without_template_errors() {
        let state = test_state();
        let node = Node {
            id: "action-mailgun-4".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "service": "Mailgun",
                    "domain": "mg.example.com",
                    "apiKey": "key-789",
                    "region": "US (api.mailgun.net)",
                    "from": "sender@example.com",
                    "to": "user@example.com",
                    "subject": "",
                    "body": ""
                }
            }),
        };

        let err = execute_email(&node, &Value::Null, &state)
            .await
            .expect_err("missing subject should fail");
        assert!(err.contains("Subject is required"));
    }
}
