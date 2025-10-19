use std::collections::HashSet;
use std::env;

use crate::engine::graph::Node;
use crate::engine::templating::templ_str;
use crate::models::oauth_token::ConnectedOAuthProvider;
use crate::models::workflow_run::WorkflowRun;
use crate::services::oauth::account_service::OAuthAccountError;
use crate::state::AppState;
use serde_json::{json, Map, Value};

const DEFAULT_SHEETS_BASE: &str = "https://sheets.googleapis.com/v4/spreadsheets";

pub(crate) async fn execute_sheets(
    node: &Node,
    context: &Value,
    state: &AppState,
    run: &WorkflowRun,
) -> Result<(Value, Option<String>), String> {
    let params = node.data.get("params").cloned().unwrap_or(Value::Null);

    let spreadsheet_id_raw = extract_required_str(&params, "spreadsheetId", "Spreadsheet ID")?;
    let worksheet_raw = extract_required_str(&params, "worksheet", "Worksheet name")?;
    let account_email = extract_required_str(&params, "accountEmail", "Google account")?;

    let spreadsheet_id = templ_str(spreadsheet_id_raw, context).trim().to_string();
    if spreadsheet_id.is_empty() {
        return Err("Spreadsheet ID is required".to_string());
    }

    let worksheet = templ_str(worksheet_raw, context).trim().to_string();
    if worksheet.is_empty() {
        return Err("Worksheet name is required".to_string());
    }

    let columns_val = params
        .get("columns")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Column mappings are required".to_string())?;
    if columns_val.is_empty() {
        return Err("At least one column mapping is required".to_string());
    }

    let mut column_map = Map::new();
    let mut seen_columns = HashSet::new();
    let mut entries: Vec<ColumnEntry> = Vec::with_capacity(columns_val.len());

    for (idx, column) in columns_val.iter().enumerate() {
        let raw_key = column
            .get("key")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("Column name is required for mapping {}", idx + 1))?;

        if raw_key.contains('{') || raw_key.contains('}') {
            return Err(format!(
                "Column name `{}` cannot contain template expressions",
                raw_key
            ));
        }

        let (normalized_key, column_index) =
            parse_column_key(raw_key).map_err(|msg| format!("{} (mapping {})", msg, idx + 1))?;

        if !seen_columns.insert(column_index) {
            return Err(format!(
                "Duplicate column `{}` detected. Each mapping must target a unique column",
                normalized_key
            ));
        }

        let value_raw = column.get("value").and_then(|v| v.as_str()).unwrap_or("");
        let templated_value = templ_str(value_raw, context);

        column_map.insert(
            normalized_key.clone(),
            Value::String(templated_value.clone()),
        );

        entries.push(ColumnEntry {
            index: column_index,
            value: templated_value,
        });
    }

    entries.sort_by_key(|entry| entry.index);

    let min_index = entries
        .first()
        .map(|entry| entry.index)
        .ok_or_else(|| "At least one column mapping is required".to_string())?;
    let max_index = entries
        .last()
        .map(|entry| entry.index)
        .ok_or_else(|| "At least one column mapping is required".to_string())?;

    let row_span = max_index - min_index + 1;
    let mut row_values: Vec<String> = vec![String::new(); row_span];

    for entry in &entries {
        let offset = entry.index - min_index;
        row_values[offset] = entry.value.clone();
    }

    let token = state
        .oauth_accounts
        .ensure_valid_access_token(run.user_id, ConnectedOAuthProvider::Google)
        .await
        .map_err(map_oauth_error)?;

    if !token
        .account_email
        .eq_ignore_ascii_case(account_email.trim())
    {
        return Err(
            "Selected Google account does not match the connected account. Refresh your integration settings.".to_string(),
        );
    }

    let base_url = sheets_api_base();
    let spreadsheet_component = encode_path_component(&spreadsheet_id);

    let start_column = column_index_to_name(min_index);
    let end_column = column_index_to_name(max_index);
    let worksheet_range = if start_column == end_column {
        format!("{}!{}1", worksheet, start_column)
    } else {
        format!("{}!{}1:{}1", worksheet, start_column, end_column)
    };

    let range_component = encode_range_component(&worksheet_range);

    let url = format!(
        "{}/{}/values/{}:append",
        base_url, spreadsheet_component, range_component
    );

    let row_values_json: Vec<Value> = row_values
        .iter()
        .map(|v| Value::String(v.clone()))
        .collect();

    let request_body = json!({
        "majorDimension": "ROWS",
        "range": worksheet_range,
        "values": [row_values_json.clone()],
    });

    let response = state
        .http_client
        .post(url)
        .bearer_auth(&token.access_token)
        .query(&[
            ("valueInputOption", "USER_ENTERED"),
            ("insertDataOption", "INSERT_ROWS"),
            ("includeValuesInResponse", "true"),
        ])
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Google Sheets request failed: {e}"))?;

    let status = response.status();
    let body_text = response
        .text()
        .await
        .map_err(|e| format!("Google Sheets response read failed: {e}"))?;

    if !status.is_success() {
        let detail =
            extract_error_message(&body_text).unwrap_or_else(|| body_text.trim().to_string());
        let detail = if detail.is_empty() {
            "Unknown Google Sheets API error".to_string()
        } else {
            detail
        };
        return Err(format!(
            "Google Sheets API error (status {}): {}",
            status.as_u16(),
            detail
        ));
    }

    let parsed: Value = serde_json::from_str(&body_text).unwrap_or(Value::Null);
    let updates = parsed.get("updates");

    let mut output = Map::new();
    output.insert(
        "spreadsheetId".to_string(),
        Value::String(spreadsheet_id.clone()),
    );
    output.insert("worksheet".to_string(), Value::String(worksheet.clone()));
    output.insert(
        "accountEmail".to_string(),
        Value::String(token.account_email.clone()),
    );
    output.insert("columns".to_string(), Value::Object(column_map));
    output.insert("values".to_string(), Value::Array(row_values_json));

    if let Some(updated_range) = updates
        .and_then(|u| u.get("updatedRange"))
        .and_then(|v| v.as_str())
    {
        output.insert(
            "updatedRange".to_string(),
            Value::String(updated_range.to_string()),
        );
    }

    if let Some(updated_rows) = updates
        .and_then(|u| u.get("updatedRows"))
        .and_then(|v| v.as_i64())
    {
        output.insert(
            "updatedRows".to_string(),
            Value::Number(updated_rows.into()),
        );
    }

    if let Some(updated_columns) = updates
        .and_then(|u| u.get("updatedColumns"))
        .and_then(|v| v.as_i64())
    {
        output.insert(
            "updatedColumns".to_string(),
            Value::Number(updated_columns.into()),
        );
    }

    Ok((Value::Object(output), None))
}

const MAX_SHEETS_COLUMNS: usize = 18_278;

struct ColumnEntry {
    index: usize,
    value: String,
}

fn parse_column_key(raw_key: &str) -> Result<(String, usize), String> {
    if raw_key.is_empty() {
        return Err("Column name is required".to_string());
    }

    let normalized = raw_key.to_ascii_uppercase();
    if !normalized.chars().all(|c| c.is_ascii_uppercase()) {
        return Err(format!(
            "Column `{}` is not a valid Google Sheets column",
            raw_key
        ));
    }

    let mut index: usize = 0;
    for ch in normalized.chars() {
        let digit = (ch as u8 - b'A' + 1) as usize;
        index = index * 26 + digit;
    }

    if index == 0 || index > MAX_SHEETS_COLUMNS {
        return Err(format!(
            "Column `{}` exceeds the supported Google Sheets column range",
            raw_key
        ));
    }

    Ok((normalized, index))
}

fn column_index_to_name(mut index: usize) -> String {
    let mut name = String::new();
    while index > 0 {
        let rem = (index - 1) % 26;
        name.insert(0, (b'A' + rem as u8) as char);
        index = (index - 1) / 26;
    }
    name
}

fn extract_required_str<'a>(params: &'a Value, key: &str, field: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("{} is required", field))
}

fn map_oauth_error(err: OAuthAccountError) -> String {
    match err {
        OAuthAccountError::NotFound => {
            "No connected Google account found. Connect one from Settings → Integrations."
                .to_string()
        }
        other => format!("Failed to obtain Google access token: {other}"),
    }
}

fn sheets_api_base() -> String {
    env::var("GOOGLE_SHEETS_API_BASE")
        .ok()
        .map(|raw| raw.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_SHEETS_BASE.to_string())
}

fn encode_path_component(value: &str) -> String {
    urlencoding::encode(value).to_string()
}

fn encode_range_component(value: &str) -> String {
    urlencoding::encode(value)
        .replace("%21", "!")
        .replace("%3A", ":")
}

fn extract_error_message(body: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(body).ok()?;
    parsed
        .get("error")
        .and_then(|err| err.get("message"))
        .and_then(|msg| msg.as_str())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, OAuthProviderConfig, OAuthSettings};
    use crate::db::mock_db::{MockDb, NoopWorkflowRepository, NoopWorkspaceRepository};
    use crate::services::oauth::github::mock_github_oauth::MockGitHubOAuth;
    use crate::services::oauth::google::mock_google_oauth::MockGoogleOAuth;
    use crate::services::smtp_mailer::MockMailer;
    use once_cell::sync::Lazy;
    use reqwest::Client;
    use serde_json::json;
    use std::net::SocketAddr;
    use std::sync::{Arc, Mutex, MutexGuard};
    use std::time::Duration;
    use time::{Duration as TimeDuration, OffsetDateTime};
    use tokio::net::TcpListener;
    use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
    use tokio::task::JoinHandle;
    use uuid::Uuid;

    use crate::db::oauth_token_repository::{NewUserOAuthToken, UserOAuthTokenRepository};
    use crate::models::oauth_token::{ConnectedOAuthProvider, UserOAuthToken};
    use crate::services::oauth::account_service::OAuthAccountService;
    use crate::services::smtp_mailer::Mailer;
    use async_trait::async_trait;
    use axum::body::{Body, Bytes};
    use axum::extract::State;
    use axum::http::{Method, StatusCode, Uri};
    use axum::response::Response;
    use axum::routing::post;
    use axum::Router;

    static ENV_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    struct EnvGuard {
        key: &'static str,
        previous: Option<String>,
        _lock: MutexGuard<'static, ()>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: String) -> Self {
            let lock = ENV_LOCK.lock().expect("env mutex poisoned");
            let previous = env::var(key).ok();
            env::set_var(key, value);
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
                env::set_var(self.key, previous);
            } else {
                env::remove_var(self.key);
            }
        }
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

    fn sample_run(user_id: Uuid) -> WorkflowRun {
        let now = OffsetDateTime::now_utc();
        WorkflowRun {
            id: Uuid::new_v4(),
            user_id,
            workflow_id: Uuid::new_v4(),
            snapshot: json!({}),
            status: "pending".to_string(),
            error: None,
            idempotency_key: None,
            started_at: now,
            finished_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn test_state(oauth_accounts: Arc<OAuthAccountService>, http_client: Arc<Client>) -> AppState {
        AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo: Arc::new(NoopWorkflowRepository::default()),
            workspace_repo: Arc::new(NoopWorkspaceRepository::default()),
            mailer: Arc::new(MockMailer::default()) as Arc<dyn Mailer>,
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts,
            http_client,
            config: test_config(),
            worker_id: Arc::new("worker".to_string()),
            worker_lease_seconds: 30,
        }
    }

    fn oauth_service_with_token(user_id: Uuid, email: &str) -> Arc<OAuthAccountService> {
        #[derive(Clone)]
        struct StaticRepo {
            record: UserOAuthToken,
        }

        #[async_trait]
        impl UserOAuthTokenRepository for StaticRepo {
            async fn upsert_token(
                &self,
                _new_token: NewUserOAuthToken,
            ) -> Result<UserOAuthToken, sqlx::Error> {
                Ok(self.record.clone())
            }

            async fn find_by_user_and_provider(
                &self,
                user_id: Uuid,
                provider: ConnectedOAuthProvider,
            ) -> Result<Option<UserOAuthToken>, sqlx::Error> {
                if provider == self.record.provider && user_id == self.record.user_id {
                    Ok(Some(self.record.clone()))
                } else {
                    Ok(None)
                }
            }

            async fn delete_token(
                &self,
                _user_id: Uuid,
                _provider: ConnectedOAuthProvider,
            ) -> Result<(), sqlx::Error> {
                Ok(())
            }

            async fn list_tokens_for_user(
                &self,
                user_id: Uuid,
            ) -> Result<Vec<UserOAuthToken>, sqlx::Error> {
                if user_id == self.record.user_id {
                    Ok(vec![self.record.clone()])
                } else {
                    Ok(vec![])
                }
            }
        }

        let key = Arc::new(vec![1u8; 32]);
        let encrypted_access =
            crate::utils::encryption::encrypt_secret(&key, "access-token").unwrap();
        let encrypted_refresh =
            crate::utils::encryption::encrypt_secret(&key, "refresh-token").unwrap();
        let now = OffsetDateTime::now_utc();

        let record = UserOAuthToken {
            id: Uuid::new_v4(),
            user_id,
            provider: ConnectedOAuthProvider::Google,
            access_token: encrypted_access,
            refresh_token: encrypted_refresh,
            expires_at: now + TimeDuration::hours(2),
            account_email: email.to_string(),
            created_at: now,
            updated_at: now,
        };

        let repo = Arc::new(StaticRepo { record });
        let client = Arc::new(Client::new());
        let settings = OAuthSettings {
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
            token_encryption_key: (*key).clone(),
        };

        Arc::new(OAuthAccountService::new(repo, key, client, &settings))
    }

    #[tokio::test]
    async fn missing_required_fields_error() {
        let node = Node {
            id: "node-1".into(),
            kind: "action".into(),
            data: json!({ "params": { "worksheet": "Sheet1", "columns": [] } }),
        };

        let state = test_state(OAuthAccountService::test_stub(), Arc::new(Client::new()));
        let run = sample_run(Uuid::new_v4());

        let err = execute_sheets(&node, &Value::Null, &state, &run)
            .await
            .expect_err("should fail without spreadsheet id");

        assert!(err.contains("Spreadsheet ID is required"));
    }

    #[tokio::test]
    async fn no_connected_account_returns_helpful_error() {
        let node = Node {
            id: "node-1".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "spreadsheetId": "abc123",
                    "worksheet": "Sheet1",
                    "accountEmail": "user@example.com",
                    "columns": [
                        {"key": "A", "value": "1"}
                    ]
                }
            }),
        };

        let state = test_state(OAuthAccountService::test_stub(), Arc::new(Client::new()));
        let run = sample_run(Uuid::new_v4());

        let err = execute_sheets(&node, &Value::Null, &state, &run)
            .await
            .expect_err("should surface missing account error");

        assert!(err.contains("No connected Google account"));
    }

    #[tokio::test]
    async fn account_email_mismatch_rejected() {
        let user_id = Uuid::new_v4();
        let oauth_accounts = oauth_service_with_token(user_id, "different@example.com");
        let state = test_state(oauth_accounts, Arc::new(Client::new()));
        let run = sample_run(user_id);

        let node = Node {
            id: "node-1".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "spreadsheetId": "abc123",
                    "worksheet": "Sheet1",
                    "accountEmail": "user@example.com",
                    "columns": [
                        {"key": "A", "value": "{{foo}}"}
                    ]
                }
            }),
        };

        let err = execute_sheets(&node, &json!({"foo": "value"}), &state, &run)
            .await
            .expect_err("mismatched email should error");

        assert!(err.contains("does not match the connected account"));
    }

    #[derive(Debug)]
    struct RecordedRequest {
        method: Method,
        uri: Uri,
        body: Vec<u8>,
    }

    #[derive(Clone)]
    struct StubState<F>
    where
        F: Fn() -> Response<Body> + Send + Sync + Clone + 'static,
    {
        tx: UnboundedSender<RecordedRequest>,
        response_factory: Arc<F>,
    }

    async fn stub_handler<F>(
        State(state): State<StubState<F>>,
        method: Method,
        uri: Uri,
        body: Bytes,
    ) -> Response<Body>
    where
        F: Fn() -> Response<Body> + Send + Sync + Clone + 'static,
    {
        let record = RecordedRequest {
            method,
            uri,
            body: body.to_vec(),
        };
        let _ = state.tx.send(record);
        (state.response_factory)()
    }

    async fn spawn_sheets_stub_server<F>(
        response_factory: F,
    ) -> (
        SocketAddr,
        UnboundedReceiver<RecordedRequest>,
        JoinHandle<()>,
    )
    where
        F: Fn() -> Response<Body> + Send + Sync + Clone + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = unbounded_channel();
        let state = StubState {
            tx,
            response_factory: Arc::new(response_factory),
        };

        let app = Router::new()
            .route("/v4/spreadsheets/{*rest}", post(stub_handler::<F>))
            .with_state(state);

        let server = axum::serve(listener, app.into_make_service());
        let handle = tokio::spawn(async move {
            if let Err(err) = server.await {
                eprintln!("sheets stub server error: {err}");
            }
        });

        (addr, rx, handle)
    }

    #[tokio::test]
    async fn successful_append_posts_row() {
        let user_id = Uuid::new_v4();
        let oauth_accounts = oauth_service_with_token(user_id, "user@example.com");

        let response_body = json!({
            "updates": {
                "updatedRange": "Sheet1!A2:C2",
                "updatedRows": 1,
                "updatedColumns": 3
            }
        });

        let (addr, mut rx, handle) = spawn_sheets_stub_server(move || {
            Response::builder()
                .status(StatusCode::OK)
                .body(Body::from(response_body.to_string()))
                .unwrap()
        })
        .await;

        let _guard = EnvGuard::set(
            "GOOGLE_SHEETS_API_BASE",
            format!("http://{}/v4/spreadsheets", addr),
        );

        let http_client = Arc::new(
            Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap(),
        );
        let state = test_state(oauth_accounts, http_client);
        let run = sample_run(user_id);

        let node = Node {
            id: "node-1".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "spreadsheetId": "abc123",
                    "worksheet": "Sheet1",
                    "accountEmail": "user@example.com",
                    "columns": [
                        {"key": "A", "value": "{{foo}}"},
                        {"key": "B", "value": "{{bar}}"}
                    ]
                }
            }),
        };

        let (output, _) =
            execute_sheets(&node, &json!({"foo": "alpha", "bar": "beta"}), &state, &run)
                .await
                .expect("append should succeed");

        let recorded = rx.recv().await.expect("request should be recorded");
        assert_eq!(recorded.method, Method::POST);
        assert!(recorded
            .uri
            .path()
            .contains("/v4/spreadsheets/abc123/values/Sheet1!A1:B1:append"));

        let body_json: Value = serde_json::from_slice(&recorded.body).unwrap();
        assert_eq!(body_json["range"], "Sheet1!A1:B1");
        assert_eq!(
            body_json["values"].as_array().unwrap()[0]
                .as_array()
                .unwrap()[0],
            "alpha"
        );
        assert_eq!(
            body_json["values"].as_array().unwrap()[0]
                .as_array()
                .unwrap()[1],
            "beta"
        );

        assert_eq!(output["updatedRows"], Value::Number(1.into()));
        assert_eq!(
            output["accountEmail"],
            Value::String("user@example.com".into())
        );

        handle.abort();
    }

    #[tokio::test]
    async fn non_contiguous_columns_include_blank_cells() {
        let user_id = Uuid::new_v4();
        let oauth_accounts = oauth_service_with_token(user_id, "user@example.com");

        let response_body = json!({
            "updates": {
                "updatedRange": "Sheet1!B2:D2",
                "updatedRows": 1,
                "updatedColumns": 3
            }
        });

        let (addr, mut rx, handle) = spawn_sheets_stub_server(move || {
            Response::builder()
                .status(StatusCode::OK)
                .body(Body::from(response_body.to_string()))
                .unwrap()
        })
        .await;

        let _guard = EnvGuard::set(
            "GOOGLE_SHEETS_API_BASE",
            format!("http://{}/v4/spreadsheets", addr),
        );

        let http_client = Arc::new(
            Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap(),
        );
        let state = test_state(oauth_accounts, http_client);
        let run = sample_run(user_id);

        let node = Node {
            id: "node-1".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "spreadsheetId": "abc123",
                    "worksheet": "Sheet1",
                    "accountEmail": "user@example.com",
                    "columns": [
                        {"key": "b", "value": "{{middle}}"},
                        {"key": "D", "value": "{{last}}"}
                    ]
                }
            }),
        };

        execute_sheets(
            &node,
            &json!({"middle": "beta", "last": "delta"}),
            &state,
            &run,
        )
        .await
        .expect("append should succeed");

        let recorded = rx.recv().await.expect("request should be recorded");
        assert!(recorded
            .uri
            .path()
            .contains("/v4/spreadsheets/abc123/values/Sheet1!B1:D1:append"));

        let body_json: Value = serde_json::from_slice(&recorded.body).unwrap();
        assert_eq!(body_json["range"], "Sheet1!B1:D1");
        let values = body_json["values"].as_array().unwrap()[0]
            .as_array()
            .unwrap();
        assert_eq!(values[0], "beta");
        assert_eq!(values[1], "");
        assert_eq!(values[2], "delta");

        handle.abort();
    }

    #[tokio::test]
    async fn invalid_column_name_rejected() {
        let user_id = Uuid::new_v4();
        let oauth_accounts = oauth_service_with_token(user_id, "user@example.com");
        let state = test_state(oauth_accounts, Arc::new(Client::new()));
        let run = sample_run(user_id);

        let node = Node {
            id: "node-1".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "spreadsheetId": "abc123",
                    "worksheet": "Sheet1",
                    "accountEmail": "user@example.com",
                    "columns": [
                        {"key": "1A", "value": "foo"}
                    ]
                }
            }),
        };

        let err = execute_sheets(&node, &Value::Null, &state, &run)
            .await
            .expect_err("invalid column should fail");

        assert!(err.contains("not a valid Google Sheets column"));
    }

    #[tokio::test]
    async fn duplicate_columns_rejected() {
        let user_id = Uuid::new_v4();
        let oauth_accounts = oauth_service_with_token(user_id, "user@example.com");
        let state = test_state(oauth_accounts, Arc::new(Client::new()));
        let run = sample_run(user_id);

        let node = Node {
            id: "node-1".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "spreadsheetId": "abc123",
                    "worksheet": "Sheet1",
                    "accountEmail": "user@example.com",
                    "columns": [
                        {"key": "A", "value": "foo"},
                        {"key": "a", "value": "bar"}
                    ]
                }
            }),
        };

        let err = execute_sheets(&node, &Value::Null, &state, &run)
            .await
            .expect_err("duplicate columns should fail");

        assert!(
            err.contains("Duplicate column `A` detected. Each mapping must target a unique column")
        );
    }

    #[tokio::test]
    async fn templated_column_rejected() {
        let user_id = Uuid::new_v4();
        let oauth_accounts = oauth_service_with_token(user_id, "user@example.com");
        let state = test_state(oauth_accounts, Arc::new(Client::new()));
        let run = sample_run(user_id);

        let node = Node {
            id: "node-1".into(),
            kind: "action".into(),
            data: json!({
                "params": {
                    "spreadsheetId": "abc123",
                    "worksheet": "Sheet1",
                    "accountEmail": "user@example.com",
                    "columns": [
                        {"key": "{{foo}}", "value": "bar"}
                    ]
                }
            }),
        };

        let err = execute_sheets(&node, &Value::Null, &state, &run)
            .await
            .expect_err("templated column should fail");

        assert!(err.contains("cannot contain template expressions"));
    }
}
