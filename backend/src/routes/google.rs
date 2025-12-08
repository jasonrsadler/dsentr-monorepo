use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tracing::error;
use uuid::Uuid;

use crate::models::oauth_token::ConnectedOAuthProvider;
use crate::responses::JsonResponse;
use crate::routes::auth::session::AuthSession;
use crate::services::oauth::workspace_service::WorkspaceOAuthError;
use crate::state::AppState;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConnectionQuery {
    scope: Option<String>,
    connection_id: Option<Uuid>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SheetPayload {
    id: String,
    title: String,
}

#[derive(Serialize)]
struct SheetsResponse {
    success: bool,
    sheets: Vec<SheetPayload>,
}

// Simple in-process cache: spreadsheet_id -> (expiry, sheets)
#[allow(clippy::type_complexity)]
static SHEETS_CACHE: once_cell::sync::Lazy<Mutex<HashMap<String, (Instant, Vec<SheetPayload>)>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));

const CACHE_TTL: Duration = Duration::from_secs(30);

pub async fn list_spreadsheet_sheets(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(spreadsheet_id): Path<String>,
    Query(query): Query<ConnectionQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user identifier").into_response(),
    };

    // Determine token based on requested scope
    let token = match determine_scope_and_token(&state, user_id, &query).await {
        Ok(tok) => tok,
        Err(resp) => return resp,
    };

    let trimmed = spreadsheet_id.trim();
    if trimmed.is_empty() {
        return JsonResponse::bad_request("Spreadsheet ID is required").into_response();
    }

    // Check cache
    if let Ok(guard) = SHEETS_CACHE.lock() {
        if let Some((expiry, sheets)) = guard.get(trimmed) {
            if *expiry > Instant::now() {
                return Json(SheetsResponse {
                    success: true,
                    sheets: sheets.clone(),
                })
                .into_response();
            }
        }
    }

    let url = format!(
        "https://sheets.googleapis.com/v4/spreadsheets/{}?fields=sheets.properties.sheetId,sheets.properties.title",
        urlencoding::encode(trimmed)
    );

    let res = match state
        .http_client
        .get(&url)
        .bearer_auth(&token.access_token)
        .send()
        .await
    {
        Ok(r) => r,
        Err(err) => {
            error!(%err, "failed to call google sheets api");
            return JsonResponse::server_error("Failed to call Google Sheets API").into_response();
        }
    };

    let status = res.status();
    let body_text = match res.text().await {
        Ok(t) => t,
        Err(err) => {
            error!(%err, "failed to read google sheets response");
            return JsonResponse::server_error("Failed to read Google Sheets response").into_response();
        }
    };

    if !status.is_success() {
        // Map common Google errors
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return JsonResponse::unauthorized(
                "Google returned an authentication error. Reconnect the integration.",
            )
            .into_response();
        }
        if status.as_u16() == 404 {
            return JsonResponse::not_found("Spreadsheet not found").into_response();
        }
        if status.as_u16() == 429 {
            return JsonResponse::too_many_requests(
                "Google rate limit reached. Try again later.",
            )
            .into_response();
        }

        return JsonResponse::server_error(&format!(
            "Google Sheets API error (status {}): {}",
            status.as_u16(),
            body_text
        ))
        .into_response();
    }

    #[derive(serde::Deserialize)]
    struct SheetsList {
        sheets: Option<Vec<SheetsListEntry>>,
    }

    #[derive(serde::Deserialize)]
    struct SheetsListEntry {
        properties: Option<SheetsProps>,
    }

    #[derive(serde::Deserialize)]
    struct SheetsProps {
        #[serde(rename = "sheetId")]
        sheet_id: Option<serde_json::Number>,
        title: Option<String>,
    }

    let parsed: SheetsList = match serde_json::from_str(&body_text) {
        Ok(p) => p,
        Err(err) => {
            error!(%err, body = %body_text, "invalid json from google sheets");
            return JsonResponse::server_error("Invalid response from Google Sheets API").into_response();
        }
    };

    let mut out: Vec<SheetPayload> = Vec::new();
    if let Some(entries) = parsed.sheets {
        for e in entries.into_iter() {
            if let Some(props) = e.properties {
                if let Some(title) = props.title {
                    let id = props
                        .sheet_id
                        .map(|n| n.to_string())
                        .unwrap_or_else(|| title.clone());
                    out.push(SheetPayload { id, title });
                }
            }
        }
    }

    // Update cache
    if let Ok(mut guard) = SHEETS_CACHE.lock() {
        guard.insert(trimmed.to_string(), (Instant::now() + CACHE_TTL, out.clone()));
    }

    Json(SheetsResponse {
        success: true,
        sheets: out,
    })
    .into_response()
}

// tests are moved to the end of the file to satisfy clippy's
// `items_after_test_module` lint (test modules should be last)

async fn determine_scope_and_token(
    state: &AppState,
    user_id: Uuid,
    query: &ConnectionQuery,
) -> Result<StoredOAuthTokenProxy, Response> {
    // Determine requested scope
    let scope = query
        .scope
        .as_deref()
        .unwrap_or("personal");

    match scope {
        "workspace" => {
            let conn_id = match query.connection_id {
                Some(id) => id,
                None => {
                    return Err(JsonResponse::bad_request("connection_id is required for workspace scope").into_response())
                }
            };

            // Ensure connection exists and belongs to workspace & has plan/membership
            match state
                .workspace_oauth
                .get_connection(user_id, conn_id, ConnectedOAuthProvider::Google)
                .await
            {
                Ok(_conn) => {
                    match state
                        .workspace_oauth
                        .ensure_valid_workspace_token(conn_id)
                        .await
                    {
                        Ok(connection) => Ok(StoredOAuthTokenProxy {
                            access_token: connection.access_token.clone(),
                        }),
                        Err(err) => Err(map_workspace_oauth_error(err)),
                    }
                }
                Err(_) => Err(JsonResponse::forbidden("Google connection not found or not allowed for this workspace").into_response()),
            }
        }
        _ => match state
            .oauth_accounts
            .ensure_valid_access_token(user_id, ConnectedOAuthProvider::Google)
            .await
        {
            Ok(tok) => Ok(StoredOAuthTokenProxy {
                access_token: tok.access_token.clone(),
            }),
            Err(e) => Err(crate::routes::oauth::map_oauth_error(e)),
        },
    }
}

fn map_workspace_oauth_error(err: WorkspaceOAuthError) -> Response {
    match err {
        WorkspaceOAuthError::NotFound => JsonResponse::forbidden("Connection not found").into_response(),
        WorkspaceOAuthError::Forbidden => JsonResponse::forbidden("Forbidden").into_response(),
        WorkspaceOAuthError::Database(e) => {
            JsonResponse::server_error(&format!("Workspace OAuth database error: {}", e)).into_response()
        }
        WorkspaceOAuthError::Encryption(e) => {
            JsonResponse::server_error(&format!("Workspace OAuth encryption error: {}", e)).into_response()
        }
        WorkspaceOAuthError::OAuth(e) => crate::routes::oauth::map_oauth_error(e),
    }
}

// Small proxy type used to unify token shapes returned for personal and workspace tokens
struct StoredOAuthTokenProxy {
    access_token: String,
}

#[cfg(test)]
mod tests {
    #[test]
    fn parse_google_sheets_list_response() {
        let sample = r#"
        {
          "sheets": [
            { "properties": { "sheetId": 0, "title": "Sheet1" } },
            { "properties": { "sheetId": 12345, "title": "Data" } }
          ]
        }
        "#;

        #[derive(serde::Deserialize)]
        struct SheetsList {
            sheets: Option<Vec<SheetsListEntry>>,
        }

        #[derive(serde::Deserialize)]
        struct SheetsListEntry {
            properties: Option<SheetsProps>,
        }

        #[derive(serde::Deserialize)]
        struct SheetsProps {
            #[serde(rename = "sheetId")]
            sheet_id: Option<serde_json::Number>,
            title: Option<String>,
        }

        let parsed: SheetsList = serde_json::from_str(sample).expect("parse should succeed");
        let sheets = parsed.sheets.expect("sheets present");
        assert_eq!(sheets.len(), 2);
        let first = sheets[0].properties.as_ref().unwrap();
        assert_eq!(first.title.as_deref(), Some("Sheet1"));
        assert_eq!(first.sheet_id.as_ref().map(|n| n.as_i64().unwrap()), Some(0));
    }
}
