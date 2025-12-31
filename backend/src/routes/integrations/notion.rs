use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Response},
    Json,
};
use http::StatusCode;
use serde::{Deserialize, Serialize};
use tracing::error;
use uuid::Uuid;

use crate::models::oauth_token::ConnectedOAuthProvider;
use crate::responses::JsonResponse;
use crate::routes::auth::session::AuthSession;
use crate::services::notion::{self, NotionDatabase, NotionError};
use crate::services::oauth::account_service::OAuthAccountError;
use crate::services::oauth::workspace_service::WorkspaceOAuthError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionConnectionQuery {
    #[serde(default, alias = "scope")]
    pub connection_scope: Option<String>,
    #[serde(default, alias = "connection_id")]
    pub connection_id: Option<Uuid>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default, alias = "cursor")]
    pub start_cursor: Option<String>,
    #[serde(default)]
    pub page_size: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotionDatabasePayload {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotionSelectOptionPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotionPropertyPayload {
    property_id: String,
    name: String,
    property_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    options: Option<Vec<NotionSelectOptionPayload>>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    is_title: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotionDatabasesResponse {
    success: bool,
    databases: Vec<NotionDatabasePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_cursor: Option<String>,
    has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotionDatabaseSchemaResponse {
    success: bool,
    database_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title_property_id: Option<String>,
    properties: Vec<NotionPropertyPayload>,
}

pub async fn list_notion_databases(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Query(query): Query<NotionConnectionQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user identifier").into_response(),
    };

    let access_token = match resolve_access_token(&state, user_id, &query).await {
        Ok(token) => token,
        Err(resp) => return resp,
    };

    let response = match notion::search_databases(
        &state.http_client,
        &access_token,
        query.search.as_deref(),
        query.start_cursor.as_deref(),
        query.page_size,
    )
    .await
    {
        Ok(res) => res,
        Err(err) => return map_notion_error(err),
    };

    let mut databases = response
        .results
        .into_iter()
        .map(to_database_payload)
        .collect::<Vec<_>>();
    databases.sort_by(|a, b| a.name.cmp(&b.name));

    Json(NotionDatabasesResponse {
        success: true,
        databases,
        next_cursor: response.next_cursor,
        has_more: response.has_more,
    })
    .into_response()
}

pub async fn get_notion_database_schema(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(database_id): Path<String>,
    Query(query): Query<NotionConnectionQuery>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user identifier").into_response(),
    };

    let access_token = match resolve_access_token(&state, user_id, &query).await {
        Ok(token) => token,
        Err(resp) => return resp,
    };

    let database =
        match notion::retrieve_database(&state.http_client, &access_token, &database_id).await {
            Ok(db) => db,
            Err(err) => return map_notion_error(err),
        };

    let mut properties = Vec::new();
    let mut title_property_id = None;
    for (key, prop) in database.properties.into_iter() {
        let name = if prop.name.trim().is_empty() {
            key.clone()
        } else {
            prop.name.clone()
        };
        let options = match prop.property_type.as_str() {
            "select" => prop.select.as_ref().map(select_options_payload),
            "multi_select" => prop.multi_select.as_ref().map(select_options_payload),
            _ => None,
        };
        let is_title = prop.property_type.eq_ignore_ascii_case("title");
        if is_title {
            title_property_id = Some(prop.id.clone());
        }
        properties.push(NotionPropertyPayload {
            property_id: prop.id,
            name,
            property_type: prop.property_type,
            options,
            is_title,
        });
    }
    properties.sort_by(|a, b| a.name.cmp(&b.name));

    Json(NotionDatabaseSchemaResponse {
        success: true,
        database_id: database.id,
        title_property_id,
        properties,
    })
    .into_response()
}

fn to_database_payload(database: NotionDatabase) -> NotionDatabasePayload {
    let title = notion::rich_text_plain_text(&database.title);
    let name = if title.is_empty() {
        database.id.clone()
    } else {
        title
    };
    NotionDatabasePayload {
        id: database.id,
        name,
        url: database.url,
    }
}

fn select_options_payload(select: &notion::NotionSelect) -> Vec<NotionSelectOptionPayload> {
    select
        .options
        .iter()
        .map(|option| NotionSelectOptionPayload {
            id: option.id.clone(),
            name: option.name.clone(),
            color: option.color.clone(),
        })
        .collect()
}

async fn resolve_access_token(
    state: &AppState,
    user_id: Uuid,
    query: &NotionConnectionQuery,
) -> Result<String, Response> {
    let scope = query
        .connection_scope
        .as_deref()
        .map(|value| value.trim().to_ascii_lowercase())
        .ok_or_else(|| JsonResponse::bad_request("connectionScope is required").into_response())?;

    match scope.as_str() {
        "workspace" => {
            let connection_id = query.connection_id.ok_or_else(|| {
                JsonResponse::bad_request("connectionId is required for workspace scope")
                    .into_response()
            })?;

            let connection = state
                .workspace_oauth
                .get_connection(user_id, connection_id, ConnectedOAuthProvider::Notion)
                .await
                .map_err(map_workspace_oauth_error)?;

            let token = state
                .workspace_oauth
                .ensure_valid_workspace_token(connection_id)
                .await
                .map_err(map_workspace_oauth_error)?;

            if token.provider != ConnectedOAuthProvider::Notion {
                return Err(JsonResponse::bad_request(
                    "Selected connection is not a Notion connection",
                )
                .into_response());
            }

            if token.workspace_id != connection.workspace_id {
                return Err(JsonResponse::forbidden(
                    "Notion connection does not belong to this workspace",
                )
                .into_response());
            }

            Ok(token.access_token)
        }
        "personal" | "user" => {
            let connection_id = query.connection_id.ok_or_else(|| {
                JsonResponse::bad_request("connectionId is required for personal scope")
                    .into_response()
            })?;

            let token = state
                .oauth_accounts
                .ensure_valid_access_token_for_connection(user_id, connection_id)
                .await
                .map_err(map_oauth_error)?;

            if token.provider != ConnectedOAuthProvider::Notion {
                return Err(JsonResponse::bad_request(
                    "Selected connection is not a Notion connection",
                )
                .into_response());
            }

            Ok(token.access_token)
        }
        _ => Err(JsonResponse::bad_request("Unsupported connectionScope").into_response()),
    }
}

fn map_oauth_error(err: OAuthAccountError) -> Response {
    match err {
        OAuthAccountError::NotFound => {
            JsonResponse::not_found("No Notion connection found").into_response()
        }
        OAuthAccountError::TokenRevoked { .. } => JsonResponse::conflict(
            "The Notion connection was revoked. Reconnect in Settings -> Integrations.",
        )
        .into_response(),
        OAuthAccountError::Database(err) => {
            error!(?err, "failed to load Notion OAuth token");
            JsonResponse::server_error("Failed to load Notion connection").into_response()
        }
        OAuthAccountError::Encryption(err) => {
            error!(?err, "failed to decrypt Notion OAuth token");
            JsonResponse::server_error("Failed to decrypt Notion connection").into_response()
        }
        other => {
            JsonResponse::server_error(&format!("Notion OAuth error: {other}")).into_response()
        }
    }
}

fn map_workspace_oauth_error(err: WorkspaceOAuthError) -> Response {
    match err {
        WorkspaceOAuthError::Forbidden => {
            JsonResponse::forbidden("Notion workspace connection not accessible").into_response()
        }
        WorkspaceOAuthError::NotFound => {
            JsonResponse::not_found("Notion workspace connection not found").into_response()
        }
        WorkspaceOAuthError::SlackInstallRequired => {
            JsonResponse::bad_request("Slack connections require workspace installs")
                .into_response()
        }
        WorkspaceOAuthError::OAuth(inner) => map_oauth_error(inner),
        WorkspaceOAuthError::Database(err) => {
            error!(?err, "failed to load Notion workspace connection");
            JsonResponse::server_error("Failed to load Notion workspace connection").into_response()
        }
        WorkspaceOAuthError::Encryption(err) => {
            error!(?err, "failed to decrypt Notion workspace connection");
            JsonResponse::server_error("Failed to decrypt Notion workspace connection")
                .into_response()
        }
    }
}

fn map_notion_error(err: NotionError) -> Response {
    if err.is_auth_error() {
        return JsonResponse::unauthorized(
            "Notion returned an authentication error. Reconnect the integration.",
        )
        .into_response();
    }

    match err {
        NotionError::Api {
            status, message, ..
        } if status == StatusCode::NOT_FOUND => JsonResponse::not_found(&message).into_response(),
        other => {
            error!(?other, request_id = other.request_id(), "notion api error");
            JsonResponse::server_error("Notion API request failed").into_response()
        }
    }
}
