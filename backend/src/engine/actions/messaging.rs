use crate::engine::graph::Node;
use crate::engine::templating::templ_str;
use crate::models::oauth_token::ConnectedOAuthProvider;
use crate::models::workflow_run::WorkflowRun;
use crate::services::oauth::account_service::{OAuthAccountError, StoredOAuthToken};
use crate::services::oauth::workspace_service::WorkspaceOAuthError;
use crate::state::AppState;
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Url,
};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use tracing::{info, warn};
use urlencoding::encode;
use uuid::Uuid;

use super::{resolve_connection_usage, NodeConnectionUsage};

const DEFAULT_MICROSOFT_GRAPH_BASE_URL: &str = "https://graph.microsoft.com/v1.0";

pub(crate) async fn execute_messaging(
    node: &Node,
    context: &Value,
    state: &AppState,
    run: &WorkflowRun,
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
        "teams" => send_teams(node, &params, context, state, run).await,
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
    _node: &Node,
    params: &Value,
    context: &Value,
    state: &AppState,
    run: &WorkflowRun,
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
        "delegatedoauthpostasuser" => {
            send_teams_delegated_oauth(&sanitized, context, state, run).await
        }
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
    let webhook_raw = extract_required_str(params, "webhookUrl", "Webhook URL")?;

    let card_payload = params
        .get("cardJson")
        .and_then(|v| v.as_str())
        .map(|raw| templ_str(raw, context))
        .and_then(|templated| {
            if templated.trim().is_empty() {
                None
            } else {
                Some(templated)
            }
        });

    let payload = if let Some(card_raw) = card_payload {
        let payload_value: Value =
            serde_json::from_str(card_raw.trim()).map_err(|e| format!("Invalid card JSON: {e}"))?;

        let has_cards = payload_value
            .as_object()
            .map(|obj| obj.contains_key("cards") || obj.contains_key("cardsV2"))
            .unwrap_or(false);

        if !has_cards {
            return Err("Card JSON must include 'cards' or 'cardsV2'".to_string());
        }

        payload_value
    } else {
        let message_raw = extract_required_str(params, "message", "Message")?;

        let message = templ_str(message_raw, context);
        if message.trim().is_empty() {
            return Err("Message is required".to_string());
        }

        json!({ "text": message })
    };

    let parsed_url =
        Url::parse(webhook_raw).map_err(|_| "Invalid webhook URL for Google Chat".to_string())?;
    match parsed_url.scheme() {
        "http" | "https" => {}
        _ => return Err("Webhook URL for Google Chat must be HTTP or HTTPS".to_string()),
    }

    let client = reqwest::Client::new();
    let response = client
        .post(parsed_url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Google Chat webhook request failed: {e}"))?;

    let status = response.status();
    let body_text = response
        .text()
        .await
        .map_err(|e| format!("Google Chat webhook response read failed: {e}"))?;

    if !status.is_success() {
        let detail = body_text.trim();
        if detail.is_empty() {
            return Err(format!(
                "Google Chat webhook returned status {}",
                status.as_u16()
            ));
        }
        return Err(format!(
            "Google Chat webhook returned status {}: {}",
            status.as_u16(),
            detail
        ));
    }

    Ok((
        json!({
            "sent": true,
            "service": "Google Chat",
            "platform": "Google Chat",
            "status": status.as_u16(),
        }),
        None,
    ))
}

fn normalize_identifier(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_alphanumeric())
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

    if workflow_option_normalized.as_str() == "headersecretauth" {
        let header_name_raw = extract_required_str(params, "workflowHeaderName", "Header name")?;
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

    match normalize_identifier(delivery_method).as_str() {
        "incomingwebhook" => {
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
        "delegatedoauthpostasuser" => {
            let provider =
                optional_string(params, "oauthProvider").unwrap_or_else(|| "microsoft".to_string());
            map.insert("oauthProvider".into(), Value::String(provider));

            if let Some(connection_obj) = params.get("connection").and_then(|v| v.as_object()) {
                let mut sanitized = Map::new();
                if let Some(scope) = connection_obj
                    .get("connectionScope")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                {
                    sanitized.insert("connectionScope".into(), Value::String(scope.to_string()));
                }
                if let Some(id) = connection_obj
                    .get("connectionId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                {
                    sanitized.insert("connectionId".into(), Value::String(id.to_string()));
                }
                if let Some(email) = connection_obj
                    .get("accountEmail")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                {
                    sanitized.insert("accountEmail".into(), Value::String(email.to_string()));
                }
                if !sanitized.is_empty() {
                    map.insert("connection".into(), Value::Object(sanitized));
                }
            }

            if let Some(connection) = optional_string(params, "oauthConnectionId") {
                map.insert("oauthConnectionId".into(), Value::String(connection));
            }

            if let Some(email) = optional_string(params, "oauthAccountEmail") {
                map.insert("oauthAccountEmail".into(), Value::String(email));
            }

            if let Some(team_id) = optional_string(params, "teamId") {
                map.insert("teamId".into(), Value::String(team_id));
            }
            if let Some(team_name) = optional_string(params, "teamName") {
                map.insert("teamName".into(), Value::String(team_name));
            }
            if let Some(channel_id) = optional_string(params, "channelId") {
                map.insert("channelId".into(), Value::String(channel_id));
            }
            if let Some(channel_name) = optional_string(params, "channelName") {
                map.insert("channelName".into(), Value::String(channel_name));
            }

            let message_type_raw = params
                .get("messageType")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .unwrap_or("Text");

            let normalized_type = normalize_identifier(message_type_raw);
            let message_type = if normalized_type == "card" {
                "Card"
            } else {
                "Text"
            };

            map.insert(
                "messageType".into(),
                Value::String(message_type.to_string()),
            );

            if message_type == "Card" {
                if let Some(mode) = optional_string(params, "cardMode") {
                    map.insert("cardMode".into(), Value::String(mode));
                }
                if let Some(title) = optional_string(params, "cardTitle") {
                    map.insert("cardTitle".into(), Value::String(title));
                }
                if let Some(body) = optional_string(params, "cardBody") {
                    map.insert("cardBody".into(), Value::String(body));
                }
                if let Some(raw) = optional_string(params, "cardJson") {
                    map.insert("cardJson".into(), Value::String(raw));
                }
                if let Some(message) = optional_string(params, "message") {
                    // Preserve legacy message fields if present for migration purposes.
                    map.insert("message".into(), Value::String(message));
                }
            } else {
                if let Some(message) = optional_string(params, "message") {
                    map.insert("message".into(), Value::String(message));
                }
                if let Some(mentions) = sanitize_mentions_array(params) {
                    map.insert("mentions".into(), Value::Array(mentions));
                }
            }

            Value::Object(map)
        }
        _ => Value::Object(map),
    }
}

fn sanitize_mentions_array(params: &Value) -> Option<Vec<Value>> {
    let mentions = params.get("mentions")?.as_array()?;
    let mut seen = HashSet::new();
    let mut sanitized = Vec::new();

    for entry in mentions {
        let user_id = entry
            .get("userId")
            .and_then(|v| v.as_str())
            .or_else(|| entry.get("user_id").and_then(|v| v.as_str()))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        if user_id.is_empty() {
            continue;
        }

        if !seen.insert(user_id.clone()) {
            continue;
        }

        let display = entry
            .get("displayName")
            .and_then(|v| v.as_str())
            .or_else(|| entry.get("display_name").and_then(|v| v.as_str()))
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| user_id.clone());

        let mut map = Map::new();
        map.insert("userId".to_string(), Value::String(user_id.clone()));
        map.insert("displayName".to_string(), Value::String(display));

        if let Some(member_id) = entry
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
        {
            map.insert("id".to_string(), Value::String(member_id));
        }

        sanitized.push(Value::Object(map));
    }

    Some(sanitized)
}

#[derive(Clone)]
struct TeamsMentionEntry {
    user_id: String,
    display_name: String,
}

fn extract_mentions(params: &Value) -> Vec<TeamsMentionEntry> {
    params
        .get("mentions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|entry| {
                    let user_id = entry
                        .get("userId")
                        .and_then(|v| v.as_str())
                        .or_else(|| entry.get("user_id").and_then(|v| v.as_str()))?
                        .trim();

                    if user_id.is_empty() {
                        return None;
                    }

                    let display_name = entry
                        .get("displayName")
                        .and_then(|v| v.as_str())
                        .or_else(|| entry.get("display_name").and_then(|v| v.as_str()))
                        .map(|s| s.trim())
                        .filter(|s| !s.is_empty())
                        .unwrap_or(user_id);

                    Some(TeamsMentionEntry {
                        user_id: user_id.to_string(),
                        display_name: display_name.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn microsoft_graph_base_url() -> String {
    std::env::var("MICROSOFT_GRAPH_BASE_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_MICROSOFT_GRAPH_BASE_URL.to_string())
}

fn escape_html(input: &str) -> String {
    let mut escaped = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

fn text_to_html(input: &str) -> String {
    let escaped = escape_html(input);
    let mut html = String::with_capacity(escaped.len());
    for ch in escaped.chars() {
        match ch {
            '\r' => {}
            '\n' => html.push_str("<br/>"),
            _ => html.push(ch),
        }
    }
    html
}

fn graph_error_message(parsed: Option<&Value>, raw: &str) -> String {
    if let Some(Value::Object(obj)) = parsed {
        if let Some(Value::Object(error)) = obj.get("error") {
            if let Some(Value::String(message)) = error.get("message") {
                let trimmed = message.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
    }

    let fallback = raw.trim();
    if fallback.is_empty() {
        "Microsoft Graph request failed".to_string()
    } else {
        fallback.to_string()
    }
}

async fn ensure_microsoft_access_token(
    state: &AppState,
    user_id: Uuid,
) -> Result<StoredOAuthToken, String> {
    state
        .oauth_accounts
        .ensure_valid_access_token(user_id, ConnectedOAuthProvider::Microsoft)
        .await
        .map_err(|err| match err {
            OAuthAccountError::NotFound => {
                "Connect the Microsoft integration before using delegated Teams messaging"
                    .to_string()
            }
            other => format!("Failed to refresh Microsoft OAuth token: {other}"),
        })
}

fn map_workspace_microsoft_error(err: WorkspaceOAuthError) -> String {
    match err {
        WorkspaceOAuthError::NotFound => {
            "Microsoft workspace connection not found or does not belong to this workspace. Promote the connection again from Settings → Integrations.".to_string()
        }
        other => format!("Failed to obtain Microsoft workspace connection: {other}"),
    }
}

fn build_text_payload(message: &str, mentions: &[TeamsMentionEntry]) -> (Value, usize) {
    let mut content = text_to_html(message);
    let mut mention_entities = Vec::new();

    if !mentions.is_empty() {
        if !content.trim().is_empty() {
            content.push_str("<br/><br/>");
        }
        for (idx, mention) in mentions.iter().enumerate() {
            if idx > 0 {
                content.push_str("<br/>");
            }
            let escaped = escape_html(&mention.display_name);
            content.push_str(&format!("<at id=\"{}\">@{}</at>", idx, escaped));
            mention_entities.push(json!({
                "id": idx as i32,
                "mentionText": format!("@{}", mention.display_name),
                "mentioned": {
                    "user": {
                        "id": mention.user_id,
                        "displayName": mention.display_name,
                    }
                }
            }));
        }
    }

    let mention_count = mention_entities.len();

    let mut payload = json!({
        "body": {
            "contentType": "html",
            "content": content,
        }
    });

    if mention_count > 0 {
        payload["mentions"] = Value::Array(mention_entities);
    }

    (payload, mention_count)
}

fn build_card_payload(card_json: &str) -> Result<Value, String> {
    let trimmed = card_json.trim();
    if trimmed.is_empty() {
        return Err("Card JSON is required".to_string());
    }

    let parsed: Value = serde_json::from_str(trimmed)
        .map_err(|err| format!("Card JSON must be valid JSON: {err}"))?;

    let Value::Object(mut obj) = parsed else {
        return Err("Card JSON must be an object".to_string());
    };

    if obj.contains_key("attachments") {
        obj.remove("subject");

        if let Some(value) = obj.get_mut("attachments") {
            let Value::Array(attachments) = value else {
                return Err("Attachments must be an array".to_string());
            };

            for attachment in attachments {
                let Value::Object(map) = attachment else {
                    return Err("Each attachment must be an object".to_string());
                };

                if let Some(content) = map.get("content") {
                    if !content.is_string() {
                        let serialized = serde_json::to_string(content).map_err(|err| {
                            format!("Attachment content must serialize to a string: {err}")
                        })?;
                        map.insert("content".to_string(), Value::String(serialized));
                    }
                }
            }

            return Ok(Value::Object(obj));
        }
    }

    let card_type = obj
        .get("type")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Card JSON must include a 'type' field".to_string())?;

    if !card_type.eq_ignore_ascii_case("AdaptiveCard") {
        return Err("Only AdaptiveCard payloads are supported".to_string());
    }

    let card_content = Value::Object(obj);
    let card_json = serde_json::to_string(&card_content)
        .map_err(|err| format!("Card JSON must serialize to a string: {err}"))?;

    let attachment_id = "1";
    let attachment_placeholder = format!("<attachment id=\"{}\"></attachment>", attachment_id);

    Ok(json!({
        "body": {
            "contentType": "html",
            "content": attachment_placeholder,
        },
        "attachments": [{
            "id": attachment_id,
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": card_json,
            "contentUrl": Value::Null,
        }]
    }))
}

async fn send_teams_delegated_oauth(
    params: &Value,
    context: &Value,
    state: &AppState,
    run: &WorkflowRun,
) -> Result<(Value, Option<String>), String> {
    let provider = params
        .get("oauthProvider")
        .and_then(|v| v.as_str())
        .unwrap_or("microsoft");

    if normalize_identifier(provider) != "microsoft" {
        return Err(
            "Only Microsoft delegated OAuth connections are supported for Teams messaging"
                .to_string(),
        );
    }

    let connection_usage = resolve_connection_usage(params)?;

    let team_id = params
        .get("teamId")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Team ID is required for delegated Teams messaging".to_string())?;

    let channel_id = params
        .get("channelId")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Channel ID is required for delegated Teams messaging".to_string())?;

    let message_type_raw = params
        .get("messageType")
        .and_then(|v| v.as_str())
        .unwrap_or("Text");
    let message_type = if normalize_identifier(message_type_raw) == "card" {
        "Card"
    } else {
        "Text"
    };

    let (access_token, token_email) = match connection_usage {
        NodeConnectionUsage::Workspace(info) => {
            let workspace_id = run.workspace_id.ok_or_else(|| {
                "This workflow run is not associated with a workspace. Promote the Microsoft connection to the workspace or switch the action back to a personal connection.".to_string()
            })?;

            let connection = state
                .workspace_oauth
                .ensure_valid_workspace_token(workspace_id, info.connection_id)
                .await
                .map_err(map_workspace_microsoft_error)?;

            if connection.provider != ConnectedOAuthProvider::Microsoft {
                return Err("Selected connection is not a Microsoft connection".to_string());
            }

            if let Some(expected) = info.account_email.as_ref() {
                if !connection.account_email.eq_ignore_ascii_case(expected) {
                    return Err(
                        "Selected Microsoft connection does not match the expected account. Refresh your integration settings.".to_string(),
                    );
                }
            }

            (
                connection.access_token.clone(),
                connection.account_email.clone(),
            )
        }
        NodeConnectionUsage::User(info) => {
            let connection_hint = info.connection_id.clone().ok_or_else(|| {
                "Select a connected Microsoft account before using delegated Teams messaging"
                    .to_string()
            })?;

            if normalize_identifier(&connection_hint) != "microsoft" {
                return Err("Unknown Microsoft OAuth connection selected".to_string());
            }

            let token = ensure_microsoft_access_token(state, run.user_id).await?;

            if let Some(expected) = info.account_email.as_ref() {
                if !token.account_email.eq_ignore_ascii_case(expected) {
                    return Err(
                        "Selected Microsoft account does not match the connected account. Refresh your integration settings.".to_string(),
                    );
                }
            }

            (token.access_token.clone(), token.account_email.clone())
        }
    };

    let base_url = microsoft_graph_base_url();
    let target = format!(
        "{}/teams/{}/channels/{}/messages",
        base_url.trim_end_matches('/'),
        encode(team_id),
        encode(channel_id)
    );

    let (payload, mention_count) = if message_type == "Card" {
        let card_raw = params
            .get("cardJson")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Card JSON is required for delegated card messages".to_string())?;
        let templated = templ_str(card_raw, context);
        (build_card_payload(&templated)?, 0)
    } else {
        let message_raw = extract_required_str(params, "message", "Message")?;
        let templated = templ_str(message_raw, context);
        if templated.trim().is_empty() {
            return Err("Message is required".to_string());
        }
        let mentions = extract_mentions(params);
        build_text_payload(&templated, &mentions)
    };

    match serde_json::to_string(&payload) {
        Ok(serialized) => info!(
            target: "dsentr::actions::messaging::teams",
            payload = %serialized,
            "Sending Teams delegated OAuth payload"
        ),
        Err(err) => warn!(
            target: "dsentr::actions::messaging::teams",
            %err,
            "Failed to serialize Teams delegated OAuth payload for logging"
        ),
    }

    let response = state
        .http_client
        .post(&target)
        .bearer_auth(&access_token)
        .json(&payload)
        .send()
        .await
        .map_err(|err| format!("Microsoft Graph request failed: {err}"))?;

    let status = response.status();
    let body_text = response
        .text()
        .await
        .map_err(|err| format!("Failed to read Microsoft Graph response: {err}"))?;
    let parsed: Option<Value> = serde_json::from_str(&body_text).ok();

    if !status.is_success() {
        let message = graph_error_message(parsed.as_ref(), &body_text);
        return Err(format!(
            "Microsoft Graph returned status {}: {}",
            status.as_u16(),
            message
        ));
    }

    let mut output = json!({
        "sent": true,
        "service": "Teams",
        "platform": "Teams",
        "deliveryMethod": "Delegated OAuth (Post as user)",
        "status": status.as_u16(),
        "teamId": team_id,
        "channelId": channel_id,
        "messageType": message_type,
    });

    if mention_count > 0 {
        output["mentionsAdded"] = Value::Number(serde_json::Number::from(mention_count as u64));
    }

    if let Some(team_name) = params
        .get("teamName")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        output["teamName"] = Value::String(team_name.to_string());
    }

    if let Some(channel_name) = params
        .get("channelName")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        output["channelName"] = Value::String(channel_name.to_string());
    }

    if !token_email.trim().is_empty() {
        output["oauthAccountEmail"] = Value::String(token_email.clone());
    }

    if let Some(Value::Object(obj)) = parsed.as_ref() {
        if let Some(Value::String(id)) = obj.get("id") {
            output["messageId"] = Value::String(id.clone());
        }
        if let Some(Value::String(url)) = obj.get("webUrl") {
            output["webUrl"] = Value::String(url.clone());
        }
    }

    Ok((output, None))
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
    use async_trait::async_trait;
    use axum::{
        body::{to_bytes, Body},
        extract::State,
        http::{header, Request, Response, StatusCode},
        routing::post,
        Router,
    };
    use once_cell::sync::Lazy;
    use reqwest::Client;
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex, MutexGuard};
    use time::{Duration, OffsetDateTime};
    use tokio::{
        net::TcpListener,
        sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender},
        task::JoinHandle,
    };

    use crate::engine::graph::Node;
    use crate::{
        config::{Config, OAuthProviderConfig, OAuthSettings},
        db::oauth_token_repository::{NewUserOAuthToken, UserOAuthTokenRepository},
        db::{
            mock_db::{MockDb, NoopWorkflowRepository, NoopWorkspaceRepository},
            workspace_connection_repository::NoopWorkspaceConnectionRepository,
        },
        models::oauth_token::{ConnectedOAuthProvider, UserOAuthToken},
        models::workflow_run::WorkflowRun,
        services::{
            oauth::{
                account_service::OAuthAccountService, github::mock_github_oauth::MockGitHubOAuth,
                google::mock_google_oauth::MockGoogleOAuth,
                workspace_service::WorkspaceOAuthService,
            },
            smtp_mailer::MockMailer,
        },
        state::AppState,
        utils::encryption::encrypt_secret,
    };
    use sqlx::Error as SqlxError;
    use uuid::Uuid;

    static ENV_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    struct EnvGuard {
        key: &'static str,
        previous: Option<String>,
        _lock: MutexGuard<'static, ()>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: String) -> Self {
            let lock = ENV_LOCK.lock().expect("env mutex poisoned");
            let previous = std::env::var(key).ok();
            std::env::set_var(key, value);
            Self {
                key,
                previous,
                _lock: lock,
            }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            if let Some(previous) = self.previous.take() {
                std::env::set_var(self.key, previous);
            } else {
                std::env::remove_var(self.key);
            }
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
            .route("/{*path}", post(stub_handler::<F>))
            .with_state(state);

        let server = axum::serve(listener, app.into_make_service());
        let handle = tokio::spawn(async move {
            if let Err(err) = server.await {
                eprintln!("stub server exited with error: {err}");
            }
        });

        (addr, rx, handle)
    }

    fn test_config() -> Arc<Config> {
        Arc::new(Config {
            database_url: String::new(),
            frontend_origin: "http://localhost".into(),
            oauth: OAuthSettings {
                google: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                microsoft: OAuthProviderConfig {
                    client_id: "stub".into(),
                    client_secret: "stub".into(),
                    redirect_uri: "http://localhost".into(),
                },
                token_encryption_key: vec![0u8; 32],
            },
        })
    }

    fn build_state_with_oauth(
        oauth_accounts: Arc<OAuthAccountService>,
        config: Arc<Config>,
    ) -> AppState {
        AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo: Arc::new(NoopWorkflowRepository),
            workspace_repo: Arc::new(NoopWorkspaceRepository),
            workspace_connection_repo: Arc::new(NoopWorkspaceConnectionRepository::default()),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts,
            workspace_oauth: WorkspaceOAuthService::test_stub(),
            http_client: Arc::new(Client::new()),
            config,
            worker_id: Arc::new("worker".to_string()),
            worker_lease_seconds: 30,
        }
    }

    fn test_state() -> AppState {
        let config = test_config();
        build_state_with_oauth(OAuthAccountService::test_stub(), Arc::clone(&config))
    }

    fn test_run() -> WorkflowRun {
        WorkflowRun {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            workflow_id: Uuid::new_v4(),
            workspace_id: None,
            snapshot: json!({}),
            status: "pending".into(),
            error: None,
            idempotency_key: None,
            started_at: OffsetDateTime::now_utc(),
            finished_at: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        }
    }

    async fn execute_default(
        node: &Node,
        context: &Value,
    ) -> Result<(Value, Option<String>), String> {
        let state = test_state();
        let run = test_run();
        execute_messaging(node, context, &state, &run).await
    }

    #[derive(Clone)]
    struct StaticTokenRepo {
        record: UserOAuthToken,
    }

    #[async_trait]
    impl UserOAuthTokenRepository for StaticTokenRepo {
        async fn upsert_token(
            &self,
            _new_token: NewUserOAuthToken,
        ) -> Result<UserOAuthToken, SqlxError> {
            Ok(self.record.clone())
        }

        async fn find_by_user_and_provider(
            &self,
            user_id: Uuid,
            provider: ConnectedOAuthProvider,
        ) -> Result<Option<UserOAuthToken>, SqlxError> {
            if user_id == self.record.user_id && provider == self.record.provider {
                Ok(Some(self.record.clone()))
            } else {
                Ok(None)
            }
        }

        async fn delete_token(
            &self,
            _user_id: Uuid,
            _provider: ConnectedOAuthProvider,
        ) -> Result<(), SqlxError> {
            Ok(())
        }

        async fn list_tokens_for_user(
            &self,
            user_id: Uuid,
        ) -> Result<Vec<UserOAuthToken>, SqlxError> {
            if user_id == self.record.user_id {
                Ok(vec![self.record.clone()])
            } else {
                Ok(vec![])
            }
        }

        async fn mark_shared(
            &self,
            _user_id: Uuid,
            _provider: ConnectedOAuthProvider,
            _is_shared: bool,
        ) -> Result<UserOAuthToken, SqlxError> {
            Ok(self.record.clone())
        }
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

        let (output, next) = execute_default(&node, &context)
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

        let err = execute_default(&node, &Value::Null)
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

        let err = execute_default(&node, &Value::Null)
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

        let (output, _) = execute_default(&node, &context)
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

        let err = execute_default(&node, &Value::Null)
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

        let (output, _) = execute_default(&node, &Value::Null)
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

        let (output, _) = execute_default(&node, &context)
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

        let (output, _) = execute_default(&node, &Value::Null)
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

    #[test]
    fn sanitize_teams_params_preserves_delegated_fields() {
        let params = json!({
            "deliveryMethod": "Delegated OAuth (Post as user)",
            "oauthProvider": "microsoft",
            "oauthConnectionId": "microsoft",
            "oauthAccountEmail": "alice@example.com",
            "connection": {
                "connectionScope": "workspace",
                "connectionId": "123",
                "accountEmail": "alice@example.com"
            },
            "teamId": "team-1",
            "teamName": "Team One",
            "channelId": "channel-7",
            "channelName": "General",
            "messageType": "Text",
            "message": "Hello",
            "mentions": [
                { "userId": "user-1", "displayName": "Jane" },
                { "user_id": "user-2", "display_name": "John", "id": "member-2" },
                { "userId": "user-1", "displayName": "Duplicate" }
            ]
        });

        let sanitized = sanitize_teams_params(&params);
        let map = sanitized
            .as_object()
            .expect("delegated params should sanitize to an object");

        assert_eq!(
            map.get("deliveryMethod").and_then(|v| v.as_str()).unwrap(),
            "Delegated OAuth (Post as user)"
        );
        assert_eq!(
            map.get("oauthProvider").and_then(|v| v.as_str()).unwrap(),
            "microsoft"
        );
        assert_eq!(
            map.get("oauthConnectionId")
                .and_then(|v| v.as_str())
                .unwrap(),
            "microsoft"
        );
        assert_eq!(
            map.get("oauthAccountEmail")
                .and_then(|v| v.as_str())
                .unwrap(),
            "alice@example.com"
        );
        let connection_obj = map
            .get("connection")
            .and_then(|v| v.as_object())
            .expect("connection should be preserved");
        assert_eq!(
            connection_obj
                .get("connectionScope")
                .and_then(|v| v.as_str())
                .unwrap(),
            "workspace"
        );
        assert_eq!(
            connection_obj
                .get("connectionId")
                .and_then(|v| v.as_str())
                .unwrap(),
            "123"
        );
        assert_eq!(
            connection_obj
                .get("accountEmail")
                .and_then(|v| v.as_str())
                .unwrap(),
            "alice@example.com"
        );
        assert_eq!(
            map.get("teamId").and_then(|v| v.as_str()).unwrap(),
            "team-1"
        );
        assert_eq!(
            map.get("channelId").and_then(|v| v.as_str()).unwrap(),
            "channel-7"
        );
        assert_eq!(
            map.get("messageType").and_then(|v| v.as_str()).unwrap(),
            "Text"
        );
        assert_eq!(
            map.get("message").and_then(|v| v.as_str()).unwrap(),
            "Hello"
        );

        let mentions = map
            .get("mentions")
            .and_then(|v| v.as_array())
            .expect("mentions should exist");
        assert_eq!(mentions.len(), 2, "duplicate mentions should be removed");
        assert_eq!(
            mentions[0].get("userId").and_then(|v| v.as_str()).unwrap(),
            "user-1"
        );
        assert_eq!(
            mentions[1].get("id").and_then(|v| v.as_str()).unwrap(),
            "member-2"
        );
    }

    #[test]
    fn sanitize_teams_params_handles_delegated_card() {
        let params = json!({
            "deliveryMethod": "Delegated OAuth (Post as user)",
            "messageType": "Card",
            "cardMode": "Simple card builder",
            "cardTitle": "Hello from Dsentr",
            "cardBody": "Automation ran",
            "cardJson": "{\"type\":\"AdaptiveCard\"}",
            "message": "legacy"
        });

        let sanitized = sanitize_teams_params(&params);
        let map = sanitized.as_object().expect("delegated card");

        assert_eq!(
            map.get("messageType").and_then(|v| v.as_str()).unwrap(),
            "Card"
        );
        assert_eq!(
            map.get("cardMode").and_then(|v| v.as_str()).unwrap(),
            "Simple card builder"
        );
        assert_eq!(
            map.get("cardTitle").and_then(|v| v.as_str()).unwrap(),
            "Hello from Dsentr"
        );
        assert_eq!(
            map.get("cardBody").and_then(|v| v.as_str()).unwrap(),
            "Automation ran"
        );
        assert!(map.get("cardJson").is_some());
        assert!(
            map.get("message").is_some(),
            "legacy messages are preserved"
        );
        assert!(map.get("mentions").is_none());
    }

    #[test]
    fn build_card_payload_wraps_simple_cards_in_graph_message() {
        let input = r#"{
            "type": "AdaptiveCard",
            "version": "1.4",
            "body": [
                { "type": "TextBlock", "text": "Hello" }
            ]
        }"#;

        let payload = build_card_payload(input).expect("card payload");
        assert!(payload.get("subject").is_none());

        let body = payload
            .get("body")
            .and_then(|v| v.as_object())
            .expect("body");
        assert_eq!(body.get("contentType"), Some(&Value::String("html".into())));

        let content_html = body
            .get("content")
            .and_then(|v| v.as_str())
            .expect("html content");
        assert_eq!(content_html, "<attachment id=\"1\"></attachment>");

        let attachments = payload
            .get("attachments")
            .and_then(|v| v.as_array())
            .expect("attachments array");
        assert_eq!(attachments.len(), 1);

        let attachment = attachments[0].as_object().expect("attachment object");
        assert_eq!(attachment.get("id"), Some(&Value::String("1".into())));
        assert_eq!(
            attachment.get("contentType"),
            Some(&Value::String(
                "application/vnd.microsoft.card.adaptive".into()
            ))
        );
        assert_eq!(attachment.get("contentUrl"), Some(&Value::Null));

        let card_json = attachment
            .get("content")
            .and_then(|v| v.as_str())
            .expect("stringified card");
        let parsed: Value = serde_json::from_str(card_json).expect("card JSON should remain valid");
        assert_eq!(parsed["body"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn build_card_payload_normalizes_preformatted_graph_message() {
        let input = r#"{
            "subject": "Ignored",
            "body": {
                "contentType": "html",
                "content": "<attachment id=\"1\"></attachment>"
            },
            "attachments": [
                {
                    "id": "1",
                    "contentType": "application/vnd.microsoft.card.adaptive",
                    "contentUrl": null,
                    "content": {
                        "type": "AdaptiveCard",
                        "version": "1.4",
                        "body": [
                            { "type": "TextBlock", "text": "Hello" }
                        ]
                    }
                }
            ]
        }"#;

        let payload = build_card_payload(input).expect("preformatted payload");

        assert!(payload.get("subject").is_none());

        let attachments = payload
            .get("attachments")
            .and_then(|v| v.as_array())
            .expect("attachments array");
        assert_eq!(attachments.len(), 1);

        let attachment = attachments[0].as_object().expect("attachment");
        let content = attachment
            .get("content")
            .and_then(|v| v.as_str())
            .expect("string content");

        let parsed: Value =
            serde_json::from_str(content).expect("attachment content to remain valid JSON");
        assert_eq!(parsed["type"].as_str(), Some("AdaptiveCard"));
    }

    #[tokio::test]
    async fn google_chat_text_message_succeeds() {
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

        let (output, _) = execute_default(&node, &context)
            .await
            .expect("chat call succeeds");

        assert_eq!(output["service"], "Google Chat");
        assert_eq!(output["status"], 200);

        let req = rx.recv().await.expect("request recorded");
        handle.abort();
        assert_eq!(req.method, "POST");
        let content_type = req
            .headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("content-type"))
            .map(|(_, value)| value.clone())
            .unwrap_or_default();
        assert!(content_type.contains("application/json"));
        let body: Value = serde_json::from_slice(&req.body).expect("json body");
        assert_eq!(body["text"], "Hello Integrations");
    }

    #[tokio::test]
    async fn teams_delegated_text_message_sends_mentions() {
        let (addr, mut rx, handle) = spawn_stub_server(|| {
            Response::builder()
                .status(StatusCode::CREATED)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "id": "message-123",
                        "webUrl": "https://teams.microsoft.com/l/message/123"
                    })
                    .to_string(),
                ))
                .unwrap()
        })
        .await;

        let _guard = EnvGuard::set("MICROSOFT_GRAPH_BASE_URL", format!("http://{}", addr));

        let config = test_config();
        let encryption_key = Arc::new(config.oauth.token_encryption_key.clone());
        let user_id = Uuid::new_v4();

        let access_token = "delegated-access";
        let refresh_token = "delegated-refresh";
        let encrypted_access = encrypt_secret(&encryption_key, access_token).unwrap();
        let encrypted_refresh = encrypt_secret(&encryption_key, refresh_token).unwrap();

        let record = UserOAuthToken {
            id: Uuid::new_v4(),
            user_id,
            provider: ConnectedOAuthProvider::Microsoft,
            access_token: encrypted_access,
            refresh_token: encrypted_refresh,
            expires_at: OffsetDateTime::now_utc() + Duration::hours(1),
            account_email: "alice@example.com".into(),
            is_shared: false,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        };

        let repo = Arc::new(StaticTokenRepo { record }) as Arc<dyn UserOAuthTokenRepository>;
        let oauth_accounts = Arc::new(OAuthAccountService::new(
            repo,
            Arc::clone(&encryption_key),
            Arc::new(Client::new()),
            &config.oauth,
        ));

        let state = build_state_with_oauth(oauth_accounts, Arc::clone(&config));
        let mut run = test_run();
        run.user_id = user_id;

        let node = Node {
            id: "delegated-text".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "platform": "Teams",
                    "deliveryMethod": "Delegated OAuth (Post as user)",
                    "oauthProvider": "microsoft",
                    "oauthConnectionId": "microsoft",
                    "teamId": "team-1",
                    "teamName": "Team One",
                    "channelId": "channel-1",
                    "channelName": "General",
                    "messageType": "Text",
                    "message": "Hello team",
                    "mentions": [
                        { "userId": "user-1", "displayName": "Jane" },
                        { "userId": "user-2", "displayName": "John" }
                    ]
                }
            }),
        };

        let (output, _) = execute_messaging(&node, &Value::Null, &state, &run)
            .await
            .expect("delegated message should succeed");

        assert_eq!(output["status"], 201);
        assert_eq!(output["service"], "Teams");
        assert_eq!(output["messageId"], "message-123");
        assert_eq!(output["mentionsAdded"], 2);
        assert_eq!(output["oauthAccountEmail"], "alice@example.com");

        let req = rx.recv().await.expect("graph request recorded");
        handle.abort();

        assert!(req
            .uri
            .ends_with("/teams/team-1/channels/channel-1/messages"));

        let auth_header = req
            .headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("authorization"))
            .map(|(_, value)| value.clone())
            .expect("authorization header");
        assert_eq!(auth_header, format!("Bearer {}", access_token));

        let body: Value = serde_json::from_slice(&req.body).expect("graph payload");
        assert_eq!(body["body"]["contentType"], "html");
        let content = body["body"]["content"].as_str().expect("html content");
        assert!(content.contains("<at id=\"0\">@Jane</at>"));
        assert!(content.contains("<at id=\"1\">@John</at>"));

        let mentions = body["mentions"].as_array().expect("mentions array");
        assert_eq!(mentions.len(), 2);
        assert_eq!(mentions[0]["mentionText"], "@Jane");
        assert_eq!(mentions[0]["mentioned"]["user"]["id"], "user-1");
    }

    #[tokio::test]
    async fn google_chat_card_payload_succeeds() {
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
                    "platform": "Google Chat",
                    "webhookUrl": format!("http://{addr}/chat"),
                    "cardJson": r#"{
                        "cardsV2": [
                            {
                                "cardId": "updates",
                                "card": {
                                    "sections": [
                                        {
                                            "widgets": [
                                                {
                                                    "textParagraph": {
                                                        "text": "Hello {{ team }}"
                                                    }
                                                }
                                            ]
                                        }
                                    ]
                                }
                            }
                        ]
                    }"#
                }
            }),
        };

        let context = json!({ "team": "Cards" });

        let (output, _) = execute_default(&node, &context)
            .await
            .expect("card call succeeds");

        assert_eq!(output["service"], "Google Chat");
        assert_eq!(output["status"], 200);

        let req = rx.recv().await.expect("request recorded");
        handle.abort();
        assert_eq!(req.method, "POST");
        let content_type = req
            .headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("content-type"))
            .map(|(_, value)| value.clone())
            .unwrap_or_default();
        assert!(content_type.contains("application/json"));

        let body: Value = serde_json::from_slice(&req.body).expect("json body");
        assert!(body.get("cards").is_none());
        let cards_v2 = body
            .get("cardsV2")
            .and_then(|v| v.as_array())
            .expect("cardsV2 array should exist");
        assert!(!cards_v2.is_empty(), "cardsV2 should not be empty");
        let text = cards_v2[0]
            .get("card")
            .and_then(|card| card.get("sections"))
            .and_then(|sections| sections.as_array())
            .and_then(|sections| sections.first())
            .and_then(|section| section.get("widgets"))
            .and_then(|widgets| widgets.as_array())
            .and_then(|widgets| widgets.first())
            .and_then(|widget| widget.get("textParagraph"))
            .and_then(|paragraph| paragraph.get("text"))
            .and_then(|text| text.as_str())
            .expect("text paragraph should exist");
        assert_eq!(text, "Hello Cards");
    }

    #[tokio::test]
    async fn google_chat_card_payload_requires_valid_json() {
        let node = Node {
            id: "action-8".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "platform": "Google Chat",
                    "webhookUrl": "https://example.com/webhook",
                    "cardJson": "{ invalid }"
                }
            }),
        };

        let err = execute_default(&node, &Value::Null)
            .await
            .expect_err("invalid card json should fail");

        assert!(err.starts_with("Invalid card JSON:"));
    }

    #[tokio::test]
    async fn google_chat_card_payload_requires_cards_key() {
        let node = Node {
            id: "action-9".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "platform": "Google Chat",
                    "webhookUrl": "https://example.com/webhook",
                    "cardJson": "{\"text\": \"missing cards\"}"
                }
            }),
        };

        let err = execute_default(&node, &Value::Null)
            .await
            .expect_err("missing cards key should fail");

        assert_eq!(err, "Card JSON must include 'cards' or 'cardsV2'");
    }

    #[tokio::test]
    async fn teams_workspace_connection_requires_workspace_context() {
        let node = Node {
            id: "teams-workspace".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "platform": "Teams",
                    "deliveryMethod": "Delegated OAuth (Post as user)",
                    "oauthProvider": "microsoft",
                    "connection": {
                        "connectionScope": "workspace",
                        "connectionId": Uuid::new_v4(),
                    },
                    "teamId": "team-1",
                    "channelId": "channel-1",
                    "messageType": "Text",
                    "message": "Hello"
                }
            }),
        };

        let state = test_state();
        let run = test_run();

        let err = execute_messaging(&node, &Value::Null, &state, &run)
            .await
            .expect_err("workspace connections should require workspace context");

        assert!(err.contains("not associated with a workspace"));
    }

    #[tokio::test]
    async fn teams_workspace_connection_not_found_surfaces_message() {
        let node = Node {
            id: "teams-workspace-not-found".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "platform": "Teams",
                    "deliveryMethod": "Delegated OAuth (Post as user)",
                    "oauthProvider": "microsoft",
                    "connection": {
                        "connectionScope": "workspace",
                        "connectionId": Uuid::new_v4(),
                    },
                    "teamId": "team-1",
                    "channelId": "channel-1",
                    "messageType": "Text",
                    "message": "Hello"
                }
            }),
        };

        let state = test_state();
        let mut run = test_run();
        run.workspace_id = Some(Uuid::new_v4());

        let err = execute_messaging(&node, &Value::Null, &state, &run)
            .await
            .expect_err("missing workspace connection should bubble up error");

        assert!(err.contains("workspace connection not found"));
    }
}
