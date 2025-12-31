use http::StatusCode;
use reqwest::{Client, Method, RequestBuilder};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;
use thiserror::Error;
use tokio::time::sleep;

pub const NOTION_BASE_URL: &str = "https://api.notion.com/v1";
pub const NOTION_VERSION: &str = "2022-06-28";
const NOTION_MAX_RETRIES: usize = 3;
const NOTION_BACKOFF_BASE_MS: u64 = 250;
const NOTION_BACKOFF_MAX_MS: u64 = 2000;

#[derive(Debug, Error)]
pub enum NotionError {
    #[error("Notion API request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Notion API responded with status {status}: {message}")]
    Api {
        status: StatusCode,
        message: String,
        code: Option<String>,
        request_id: Option<String>,
    },
    #[error("Notion API returned an invalid response: {0}")]
    InvalidResponse(String),
}

impl NotionError {
    pub fn is_auth_error(&self) -> bool {
        matches!(
            self,
            NotionError::Api { status, .. }
                if *status == StatusCode::UNAUTHORIZED || *status == StatusCode::FORBIDDEN
        )
    }

    pub fn request_id(&self) -> Option<&str> {
        match self {
            NotionError::Api { request_id, .. } => request_id.as_deref(),
            _ => None,
        }
    }
}

#[derive(Debug, Deserialize)]
struct NotionErrorBody {
    message: Option<String>,
    code: Option<String>,
    request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NotionListResponse<T> {
    #[serde(default)]
    pub results: Vec<T>,
    #[serde(default)]
    pub next_cursor: Option<String>,
    #[serde(default)]
    pub has_more: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NotionRichText {
    #[serde(default)]
    pub plain_text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionSelectOption {
    pub id: Option<String>,
    pub name: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NotionSelect {
    #[serde(default)]
    pub options: Vec<NotionSelectOption>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NotionProperty {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(rename = "type")]
    pub property_type: String,
    #[serde(default)]
    pub select: Option<NotionSelect>,
    #[serde(default, rename = "multi_select")]
    pub multi_select: Option<NotionSelect>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct NotionDatabase {
    pub id: String,
    #[serde(default)]
    pub title: Vec<NotionRichText>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub properties: std::collections::HashMap<String, NotionProperty>,
}

pub fn rich_text_plain_text(items: &[NotionRichText]) -> String {
    let mut out = String::new();
    for item in items {
        if let Some(text) = item.plain_text.as_ref() {
            out.push_str(text);
        }
    }
    out.trim().to_string()
}

fn notion_base_url() -> String {
    #[cfg(test)]
    {
        if let Ok(value) = std::env::var("NOTION_API_BASE_URL") {
            if !value.trim().is_empty() {
                return value;
            }
        }
    }
    NOTION_BASE_URL.to_string()
}

fn build_url(base: &str, path: &str) -> String {
    let trimmed_base = base.trim_end_matches('/');
    let trimmed_path = path.trim_start_matches('/');
    format!("{}/{}", trimmed_base, trimmed_path)
}

fn build_request(
    client: &Client,
    access_token: &str,
    method: Method,
    path: &str,
) -> RequestBuilder {
    let base_url = notion_base_url();
    let url = build_url(&base_url, path);
    client
        .request(method, url)
        .bearer_auth(access_token)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, "application/json")
        .header("Notion-Version", NOTION_VERSION)
}

async fn send_request<T: DeserializeOwned>(request: RequestBuilder) -> Result<T, NotionError> {
    let mut retries = 0usize;
    let mut backoff = Duration::from_millis(NOTION_BACKOFF_BASE_MS);

    loop {
        let request = request.try_clone().ok_or_else(|| {
            NotionError::InvalidResponse("Notion request could not be retried".into())
        })?;
        let response = request.send().await?;
        let status = response.status();

        if status == reqwest::StatusCode::TOO_MANY_REQUESTS && retries < NOTION_MAX_RETRIES {
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .map(Duration::from_secs);
            let delay = retry_after.unwrap_or(backoff);
            sleep(delay).await;
            retries += 1;
            backoff =
                Duration::from_millis((backoff.as_millis() as u64 * 2).min(NOTION_BACKOFF_MAX_MS));
            continue;
        }

        let request_id = response
            .headers()
            .get("x-request-id")
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string());
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            let parsed = serde_json::from_str::<NotionErrorBody>(&body).ok();
            let message = parsed
                .as_ref()
                .and_then(|err| err.message.as_ref())
                .map(|msg| msg.trim().to_string())
                .filter(|msg| !msg.is_empty())
                .or_else(|| {
                    let trimmed = body.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                })
                .unwrap_or_else(|| "Notion API request failed".to_string());
            let status =
                StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            let request_id = parsed
                .as_ref()
                .and_then(|err| err.request_id.clone())
                .or(request_id);
            let code = parsed.and_then(|err| err.code);
            return Err(NotionError::Api {
                status,
                message,
                code,
                request_id,
            });
        }

        return serde_json::from_str::<T>(&body)
            .map_err(|err| NotionError::InvalidResponse(err.to_string()));
    }
}

pub async fn search_databases(
    client: &Client,
    access_token: &str,
    query: Option<&str>,
    start_cursor: Option<&str>,
    page_size: Option<u32>,
) -> Result<NotionListResponse<NotionDatabase>, NotionError> {
    let mut payload = json!({
        "filter": { "property": "object", "value": "database" }
    });
    if let Some(query) = query.and_then(|val| {
        let trimmed = val.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }) {
        payload["query"] = Value::String(query);
    }
    if let Some(cursor) = start_cursor.and_then(|val| {
        let trimmed = val.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }) {
        payload["start_cursor"] = Value::String(cursor);
    }
    if let Some(size) = page_size.filter(|size| *size > 0) {
        payload["page_size"] = Value::Number(size.into());
    }

    let request = build_request(client, access_token, Method::POST, "/search").json(&payload);
    send_request(request).await
}

pub async fn retrieve_database(
    client: &Client,
    access_token: &str,
    database_id: &str,
) -> Result<NotionDatabase, NotionError> {
    let trimmed = database_id.trim();
    let path = format!("/databases/{}", urlencoding::encode(trimmed));
    let request = build_request(client, access_token, Method::GET, &path);
    send_request(request).await
}

pub async fn query_database(
    client: &Client,
    access_token: &str,
    database_id: &str,
    filter: Option<Value>,
    sorts: Option<Value>,
    start_cursor: Option<&str>,
    page_size: Option<u32>,
) -> Result<NotionListResponse<Value>, NotionError> {
    let trimmed = database_id.trim();
    let path = format!("/databases/{}/query", urlencoding::encode(trimmed));
    let mut payload = json!({});
    if let Some(filter) = filter {
        payload["filter"] = filter;
    }
    if let Some(sorts) = sorts {
        payload["sorts"] = sorts;
    }
    if let Some(cursor) = start_cursor.and_then(|val| {
        let trimmed = val.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }) {
        payload["start_cursor"] = Value::String(cursor);
    }
    if let Some(size) = page_size.filter(|size| *size > 0) {
        payload["page_size"] = Value::Number(size.into());
    }

    let request = build_request(client, access_token, Method::POST, &path).json(&payload);
    send_request(request).await
}

pub async fn create_page(
    client: &Client,
    access_token: &str,
    parent_database_id: Option<&str>,
    parent_page_id: Option<&str>,
    properties: Value,
) -> Result<Value, NotionError> {
    let parent = if let Some(database_id) = parent_database_id {
        json!({ "database_id": database_id })
    } else if let Some(page_id) = parent_page_id {
        json!({ "page_id": page_id })
    } else {
        json!({})
    };

    let payload = json!({
        "parent": parent,
        "properties": properties
    });

    let request = build_request(client, access_token, Method::POST, "/pages").json(&payload);
    send_request(request).await
}

pub async fn update_page(
    client: &Client,
    access_token: &str,
    page_id: &str,
    properties: Value,
) -> Result<Value, NotionError> {
    let trimmed = page_id.trim();
    let path = format!("/pages/{}", urlencoding::encode(trimmed));
    let payload = json!({
        "properties": properties
    });
    let request = build_request(client, access_token, Method::PATCH, &path).json(&payload);
    send_request(request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    use once_cell::sync::Lazy;
    use std::sync::MutexGuard;
    use tokio::sync::Mutex;

    static CLIENT: Lazy<Mutex<Client>> = Lazy::new(|| {
        Mutex::new(
            Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("client"),
        )
    });
    static ENV_LOCK: Lazy<std::sync::Mutex<()>> = Lazy::new(|| std::sync::Mutex::new(()));

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

    #[tokio::test]
    async fn search_databases_sets_headers_and_path() {
        let client = CLIENT.lock().await;
        let server = httpmock::MockServer::start();
        let _env = EnvGuard::set("NOTION_API_BASE_URL", server.url(""));
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::POST)
                .path("/search")
                .header("authorization", "Bearer test-token")
                .header("Notion-Version", NOTION_VERSION)
                .json_body(json!({
                    "filter": { "property": "object", "value": "database" },
                    "query": "Acme"
                }));
            then.status(200)
                .header("content-type", "application/json")
                .body(
                    json!({
                        "results": [],
                        "has_more": false,
                        "next_cursor": null
                    })
                    .to_string(),
                );
        });

        let response = search_databases(&client, "test-token", Some("Acme"), None, None)
            .await
            .expect("search");

        mock.assert();
        assert!(response.results.is_empty());
        assert!(!response.has_more);
    }

    #[tokio::test]
    async fn retrieve_database_uses_expected_path() {
        let client = CLIENT.lock().await;
        let server = httpmock::MockServer::start();
        let _env = EnvGuard::set("NOTION_API_BASE_URL", server.url(""));
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/databases/db-123")
                .header("authorization", "Bearer test-token")
                .header("Notion-Version", NOTION_VERSION);
            then.status(200)
                .header("content-type", "application/json")
                .body(
                    json!({
                        "id": "db-123",
                        "title": [],
                        "properties": {}
                    })
                    .to_string(),
                );
        });

        let response = retrieve_database(&client, "test-token", "db-123")
            .await
            .expect("database");

        mock.assert();
        assert_eq!(response.id, "db-123");
    }

    #[tokio::test]
    async fn error_mapping_surfaces_status_message_and_request_id() {
        let client = CLIENT.lock().await;
        let server = httpmock::MockServer::start();
        let _env = EnvGuard::set("NOTION_API_BASE_URL", server.url(""));
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET).path("/databases/db-401");
            then.status(401)
                .header("content-type", "application/json")
                .body(
                    json!({
                        "message": "Unauthorized",
                        "request_id": "req-123"
                    })
                    .to_string(),
                );
        });

        let result = retrieve_database(&client, "token", "db-401").await;

        mock.assert();
        match result {
            Err(NotionError::Api {
                status,
                message,
                request_id,
                ..
            }) => {
                assert_eq!(status, StatusCode::UNAUTHORIZED);
                assert_eq!(message, "Unauthorized");
                assert_eq!(request_id.as_deref(), Some("req-123"));
            }
            other => panic!("unexpected result: {other:?}"),
        }
    }
}
