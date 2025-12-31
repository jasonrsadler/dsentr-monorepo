use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use crate::services::notion;
use crate::services::notion::NotionError;

const DEFAULT_PAGE_SIZE: u32 = 50;
const MAX_POLL_PAGES: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotionTriggerState {
    #[serde(default)]
    pub last_seen_created_time: Option<String>,
    #[serde(default)]
    pub last_seen_edited_time: Option<String>,
    #[serde(default)]
    pub last_seen_page_id: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionTriggerConfig {
    #[serde(default)]
    pub trigger_type: String,
    #[serde(default)]
    pub connection_scope: String,
    #[serde(default)]
    pub connection_id: String,
    #[serde(default)]
    pub database_id: String,
    #[serde(default)]
    pub page_size: Option<u32>,
    #[serde(default)]
    pub poll_interval_seconds: Option<i64>,
    #[serde(default)]
    pub state: NotionTriggerState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotionTriggerKind {
    NewDatabaseRow,
    UpdatedDatabaseRow,
}

impl NotionTriggerKind {
    pub fn from_str(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "notion.new_database_row" => Some(Self::NewDatabaseRow),
            "notion.updated_database_row" => Some(Self::UpdatedDatabaseRow),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NewDatabaseRow => "notion.new_database_row",
            Self::UpdatedDatabaseRow => "notion.updated_database_row",
        }
    }

    fn timestamp_field(&self) -> &'static str {
        match self {
            Self::NewDatabaseRow => "created_time",
            Self::UpdatedDatabaseRow => "last_edited_time",
        }
    }
}

#[derive(Debug)]
pub struct NotionPollResult {
    pub events: Vec<Value>,
    pub state: NotionTriggerState,
}

pub fn parse_trigger_config(config: &Value) -> Option<(NotionTriggerKind, NotionTriggerConfig)> {
    let trigger_type = config.get("triggerType")?.as_str()?;
    let kind = NotionTriggerKind::from_str(trigger_type)?;
    let parsed: NotionTriggerConfig = serde_json::from_value(config.clone()).ok()?;
    if parsed.database_id.trim().is_empty()
        || parsed.connection_id.trim().is_empty()
        || parsed.connection_scope.trim().is_empty()
    {
        return None;
    }
    Some((kind, parsed))
}

pub fn update_config_state(config: &Value, state: &NotionTriggerState) -> Option<Value> {
    let mut updated = config.clone();
    if let Value::Object(map) = &mut updated {
        map.insert("state".to_string(), serde_json::to_value(state).ok()?);
        return Some(updated);
    }
    None
}

pub async fn poll_database(
    client: &reqwest::Client,
    access_token: &str,
    config: &NotionTriggerConfig,
    kind: NotionTriggerKind,
) -> Result<NotionPollResult, NotionError> {
    let mut cursor = config.state.cursor.clone();
    let page_size = config.page_size.unwrap_or(DEFAULT_PAGE_SIZE).min(100);
    let sorts = json!([{
        "timestamp": kind.timestamp_field(),
        "direction": "descending"
    }]);

    let last_seen = match kind {
        NotionTriggerKind::NewDatabaseRow => config.state.last_seen_created_time.as_deref(),
        NotionTriggerKind::UpdatedDatabaseRow => config.state.last_seen_edited_time.as_deref(),
    };
    let last_seen_dt = last_seen.and_then(parse_timestamp);

    let mut events = Vec::new();
    let mut newest_dt: Option<OffsetDateTime> = None;
    let mut newest_id: Option<String> = None;
    let mut pages_fetched = 0usize;
    let mut halted_for_budget = false;

    loop {
        if pages_fetched >= MAX_POLL_PAGES {
            halted_for_budget = true;
            break;
        }
        let response = notion::query_database(
            client,
            access_token,
            &config.database_id,
            None,
            Some(sorts.clone()),
            cursor.as_deref(),
            Some(page_size),
        )
        .await?;

        pages_fetched += 1;
        let mut reached_previous = false;

        for page in response.results {
            let Some(page_id) = page.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            let Some(page_time_str) = page.get(kind.timestamp_field()).and_then(|v| v.as_str())
            else {
                continue;
            };
            let Some(page_time) = parse_timestamp(page_time_str) else {
                continue;
            };

            if last_seen_dt.is_none() {
                if newest_dt.is_none() {
                    newest_dt = Some(page_time);
                    newest_id = Some(page_id.to_string());
                }
                continue;
            }

            if let Some(last_seen_dt) = last_seen_dt {
                if page_time > last_seen_dt {
                    events.push(build_event(kind, &config.database_id, page.clone()));
                    if newest_dt.is_none_or(|current| page_time > current) {
                        newest_dt = Some(page_time);
                        newest_id = Some(page_id.to_string());
                    }
                } else {
                    reached_previous = true;
                    break;
                }
            }
        }

        if reached_previous || !response.has_more {
            cursor = None;
            break;
        }

        cursor = response.next_cursor;
    }

    let mut state = config.state.clone();
    if last_seen_dt.is_none() || !events.is_empty() {
        if let Some(newest) = newest_dt {
            let formatted = newest.format(&Rfc3339).unwrap_or_default();
            match kind {
                NotionTriggerKind::NewDatabaseRow => state.last_seen_created_time = Some(formatted),
                NotionTriggerKind::UpdatedDatabaseRow => {
                    state.last_seen_edited_time = Some(formatted)
                }
            }
            state.last_seen_page_id = newest_id;
        }
    }

    state.cursor = if halted_for_budget { cursor } else { None };

    Ok(NotionPollResult { events, state })
}

fn parse_timestamp(raw: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(raw, &Rfc3339).ok()
}

fn build_event(kind: NotionTriggerKind, database_id: &str, page: Value) -> Value {
    json!({
        "trigger": kind.as_str(),
        "databaseId": database_id,
        "page": page
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use once_cell::sync::Lazy;
    use std::sync::MutexGuard;
    use tokio::sync::Mutex;

    static CLIENT: Lazy<Mutex<reqwest::Client>> = Lazy::new(|| {
        Mutex::new(
            reqwest::Client::builder()
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

    fn page(id: &str, created: &str, edited: &str) -> Value {
        json!({
            "id": id,
            "created_time": created,
            "last_edited_time": edited
        })
    }

    #[tokio::test]
    async fn poll_initializes_state_without_emitting() {
        let client = CLIENT.lock().await;
        let server = httpmock::MockServer::start();
        let _env = EnvGuard::set("NOTION_API_BASE_URL", server.url(""));
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::POST)
                .path("/databases/db-1/query");
            then.status(200)
                .header("content-type", "application/json")
                .body(
                    json!({
                        "results": [
                            page("p1", "2024-01-02T10:00:00Z", "2024-01-02T10:00:00Z"),
                            page("p2", "2024-01-01T10:00:00Z", "2024-01-01T10:00:00Z")
                        ],
                        "has_more": false,
                        "next_cursor": null
                    })
                    .to_string(),
                );
        });

        let config = NotionTriggerConfig {
            trigger_type: "notion.new_database_row".into(),
            connection_scope: "personal".into(),
            connection_id: "conn".into(),
            database_id: "db-1".into(),
            page_size: None,
            poll_interval_seconds: None,
            state: NotionTriggerState::default(),
        };

        let result = poll_database(&client, "token", &config, NotionTriggerKind::NewDatabaseRow)
            .await
            .expect("poll");

        mock.assert();
        assert!(result.events.is_empty());
        assert_eq!(
            result.state.last_seen_created_time.as_deref(),
            Some("2024-01-02T10:00:00Z")
        );
        assert_eq!(result.state.last_seen_page_id.as_deref(), Some("p1"));
    }

    #[tokio::test]
    async fn poll_emits_new_pages_and_updates_state() {
        let client = CLIENT.lock().await;
        let server = httpmock::MockServer::start();
        let _env = EnvGuard::set("NOTION_API_BASE_URL", server.url(""));
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::POST)
                .path("/databases/db-2/query");
            then.status(200)
                .header("content-type", "application/json")
                .body(
                    json!({
                        "results": [
                            page("p-new", "2024-02-01T10:00:00Z", "2024-02-01T10:00:00Z"),
                            page("p-old", "2024-01-01T10:00:00Z", "2024-01-01T10:00:00Z")
                        ],
                        "has_more": false,
                        "next_cursor": null
                    })
                    .to_string(),
                );
        });

        let config = NotionTriggerConfig {
            trigger_type: "notion.new_database_row".into(),
            connection_scope: "personal".into(),
            connection_id: "conn".into(),
            database_id: "db-2".into(),
            page_size: None,
            poll_interval_seconds: None,
            state: NotionTriggerState {
                last_seen_created_time: Some("2024-01-15T10:00:00Z".into()),
                last_seen_edited_time: None,
                last_seen_page_id: None,
                cursor: None,
            },
        };

        let result = poll_database(&client, "token", &config, NotionTriggerKind::NewDatabaseRow)
            .await
            .expect("poll");

        mock.assert();
        assert_eq!(result.events.len(), 1);
        assert_eq!(
            result.state.last_seen_created_time.as_deref(),
            Some("2024-02-01T10:00:00Z")
        );
    }
}
