use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Response},
    Json,
};
use http::StatusCode;
use reqwest::StatusCode as ReqStatusCode;
use serde::{Deserialize, Serialize};
use tracing::error;
use uuid::Uuid;

use crate::engine::actions::{ensure_run_membership, ensure_workspace_plan};
use crate::models::oauth_token::ConnectedOAuthProvider;
use crate::models::workspace::WorkspaceMembershipSummary;
use crate::responses::JsonResponse;
use crate::routes::auth::claims::Claims;
use crate::routes::auth::session::AuthSession;
use crate::routes::oauth::map_oauth_error;
use crate::services::oauth::workspace_service::WorkspaceOAuthError;
use crate::state::AppState;
use crate::utils::plan_limits::NormalizedPlanTier;

const ASANA_BASE_URL: &str = "https://app.asana.com/api/1.0";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConnectionQuery {
    scope: Option<String>,
    connection_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UsersQuery {
    #[serde(rename = "team_gid")]
    team_gid: Option<String>,
    scope: Option<String>,
    connection_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct TasksQuery {
    #[serde(rename = "project_gid")]
    project_gid: Option<String>,
    scope: Option<String>,
    connection_id: Option<Uuid>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePayload {
    gid: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectPayload {
    gid: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TagPayload {
    gid: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SectionPayload {
    gid: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamPayload {
    gid: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserPayload {
    gid: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(default)]
struct TaskPayload {
    gid: String,
    name: String,
    notes: Option<String>,
    due_on: Option<String>,
    due_at: Option<String>,
    completed: Option<bool>,
    assignee: Option<AsanaUserRef>,
    custom_fields: Option<Vec<AsanaCustomField>>,
}

#[derive(Default, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct AsanaUserRef {
    pub gid: String,
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Default, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct AsanaCustomField {
    pub gid: String,
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub field_type: Option<String>,

    pub text_value: Option<String>,
    pub number_value: Option<f64>,

    // enum fields
    pub enum_value: Option<AsanaEnumValue>,
}

#[derive(Default, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct AsanaEnumValue {
    pub name: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct AsanaList<T> {
    data: Vec<T>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoryPayload {
    gid: String,
    text: String,
}

#[derive(Serialize)]
struct WorkspacesResponse {
    success: bool,
    workspaces: Vec<WorkspacePayload>,
}

#[derive(Serialize)]
struct ProjectsResponse {
    success: bool,
    projects: Vec<ProjectPayload>,
}

#[derive(Serialize)]
struct TagsResponse {
    success: bool,
    tags: Vec<TagPayload>,
}

#[derive(Serialize)]
struct SectionsResponse {
    success: bool,
    sections: Vec<SectionPayload>,
}

#[derive(Serialize)]
struct TeamsResponse {
    success: bool,
    teams: Vec<TeamPayload>,
}

#[derive(Serialize)]
struct UsersResponse {
    success: bool,
    users: Vec<UserPayload>,
}

#[derive(Serialize)]
struct TasksResponse {
    success: bool,
    tasks: Vec<TaskPayload>,
}

#[derive(Serialize)]
struct StoriesResponse {
    success: bool,
    stories: Vec<StoryPayload>,
}

#[derive(Debug, Deserialize)]
struct ListResponse<T> {
    data: Vec<T>,
}

#[derive(Debug, Deserialize)]
struct WorkspaceRecord {
    gid: String,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProjectRecord {
    gid: String,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TagRecord {
    gid: String,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SectionRecord {
    gid: String,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TeamRecord {
    gid: String,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UserRecord {
    gid: String,
    name: Option<String>,
    email: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct TaskRecord {
    gid: String,
    name: Option<String>,
    notes: Option<String>,
    due_on: Option<String>,
    due_at: Option<String>,
    completed: Option<bool>,
    assignee: Option<AsanaUserRef>,
    custom_fields: Option<Vec<AsanaCustomField>>,
}

#[derive(Debug, Deserialize)]
struct StoryRecord {
    gid: String,
    text: Option<String>,
    resource_subtype: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum RequestedScope {
    Personal,
    Workspace(Uuid),
}

pub async fn list_workspaces(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Query(query): Query<ConnectionQuery>,
) -> Response {
    let user_id = match parse_user_id(&claims) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    if let Err(resp) = ensure_workspace_plan_membership(&state, user_id).await {
        return resp;
    }

    let (access_token, _) = match ensure_asana_token(&state, user_id, &query).await {
        Ok(token) => token,
        Err(resp) => return resp,
    };

    match fetch_workspaces(&state, &access_token).await {
        Ok(workspaces) => Json(WorkspacesResponse {
            success: true,
            workspaces,
        })
        .into_response(),
        Err(resp) => resp,
    }
}

pub async fn list_projects(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workspace_gid): Path<String>,
    Query(query): Query<ConnectionQuery>,
) -> Response {
    let user_id = match parse_user_id(&claims) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    if let Err(resp) = ensure_workspace_plan_membership(&state, user_id).await {
        return resp;
    }

    let (access_token, _) = match ensure_asana_token(&state, user_id, &query).await {
        Ok(token) => token,
        Err(resp) => return resp,
    };

    match fetch_projects(&state, &access_token, workspace_gid.trim()).await {
        Ok(projects) => Json(ProjectsResponse {
            success: true,
            projects,
        })
        .into_response(),
        Err(resp) => resp,
    }
}

pub async fn list_tags(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workspace_gid): Path<String>,
    Query(query): Query<ConnectionQuery>,
) -> Response {
    let user_id = match parse_user_id(&claims) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    if let Err(resp) = ensure_workspace_plan_membership(&state, user_id).await {
        return resp;
    }

    let (access_token, _) = match ensure_asana_token(&state, user_id, &query).await {
        Ok(token) => token,
        Err(resp) => return resp,
    };

    match fetch_tags(&state, &access_token, workspace_gid.trim()).await {
        Ok(tags) => Json(TagsResponse {
            success: true,
            tags,
        })
        .into_response(),
        Err(resp) => resp,
    }
}

pub async fn list_sections(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(project_gid): Path<String>,
    Query(query): Query<ConnectionQuery>,
) -> Response {
    let user_id = match parse_user_id(&claims) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    if let Err(resp) = ensure_workspace_plan_membership(&state, user_id).await {
        return resp;
    }

    let (access_token, _) = match ensure_asana_token(&state, user_id, &query).await {
        Ok(token) => token,
        Err(resp) => return resp,
    };

    match fetch_sections(&state, &access_token, project_gid.trim()).await {
        Ok(sections) => Json(SectionsResponse {
            success: true,
            sections,
        })
        .into_response(),
        Err(resp) => resp,
    }
}

pub async fn list_teams(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workspace_gid): Path<String>,
    Query(query): Query<ConnectionQuery>,
) -> Response {
    let user_id = match parse_user_id(&claims) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    if let Err(resp) = ensure_workspace_plan_membership(&state, user_id).await {
        return resp;
    }

    let (access_token, _) = match ensure_asana_token(&state, user_id, &query).await {
        Ok(token) => token,
        Err(resp) => return resp,
    };

    match fetch_teams(&state, &access_token, workspace_gid.trim()).await {
        Ok(teams) => Json(TeamsResponse {
            success: true,
            teams,
        })
        .into_response(),
        Err(resp) => resp,
    }
}

pub async fn list_users(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workspace_gid): Path<String>,
    Query(query): Query<UsersQuery>,
) -> Response {
    let user_id = match parse_user_id(&claims) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    if let Err(resp) = ensure_workspace_plan_membership(&state, user_id).await {
        return resp;
    }

    let connection_query = ConnectionQuery {
        scope: query.scope.clone(),
        connection_id: query.connection_id,
    };

    let (access_token, _) = match ensure_asana_token(&state, user_id, &connection_query).await {
        Ok(token) => token,
        Err(resp) => return resp,
    };

    match fetch_users(
        &state,
        &access_token,
        workspace_gid.trim(),
        query.team_gid.as_deref(),
    )
    .await
    {
        Ok(users) => Json(UsersResponse {
            success: true,
            users,
        })
        .into_response(),
        Err(resp) => resp,
    }
}

pub async fn list_tasks(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Query(query): Query<TasksQuery>,
) -> Response {
    let user_id = match parse_user_id(&claims) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    if let Err(resp) = ensure_workspace_plan_membership(&state, user_id).await {
        return resp;
    }

    let connection_query = ConnectionQuery {
        scope: query.scope.clone(),
        connection_id: query.connection_id,
    };

    let (access_token, _) = match ensure_asana_token(&state, user_id, &connection_query).await {
        Ok(token) => token,
        Err(resp) => return resp,
    };

    let project_gid = match query.project_gid.as_deref() {
        Some(v) if !v.trim().is_empty() => v,
        _ => {
            return JsonResponse::bad_request(
                "Project is required to list tasks for Asana on this plan",
            )
            .into_response();
        }
    };

    match fetch_tasks(&state, &access_token, project_gid).await {
        Ok(tasks) => Json(TasksResponse {
            success: true,
            tasks,
        })
        .into_response(),
        Err(resp) => resp,
    }
}

#[derive(Deserialize)]
struct AsanaSingle<T> {
    data: T,
}

pub async fn get_task_details(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(task_gid): Path<String>,
    Query(query): Query<ConnectionQuery>,
) -> Response {
    // Authenticate user
    let user_id = match parse_user_id(&claims) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    // Check plan permissions
    if let Err(resp) = ensure_workspace_plan_membership(&state, user_id).await {
        return resp;
    }

    // Validate OAuth connection
    let connection_query = ConnectionQuery {
        scope: query.scope.clone(),
        connection_id: query.connection_id,
    };

    let (access_token, _) = match ensure_asana_token(&state, user_id, &connection_query).await {
        Ok(token) => token,
        Err(resp) => return resp,
    };

    // Build Asana URL for a single task
    let task_url = format!(
        "{ASANA_BASE_URL}/tasks/{}?opt_fields=name,notes,due_on,due_at,completed,assignee.gid,assignee.name,assignee.email,custom_fields,custom_fields.name,custom_fields.type,custom_fields.text_value,custom_fields.number_value,custom_fields.enum_value.name",
        urlencoding::encode(&task_gid)
    );

    // Fetch full single-task object (wrapped in "data")
    let wrapped: AsanaSingle<TaskRecord> = match get_json(&state, &access_token, &task_url).await {
        Ok(rec) => rec,
        Err(resp) => return resp,
    };

    let record = wrapped.data;

    // Build TaskPayload
    let payload = TaskPayload {
        gid: record.gid.trim().to_string(),
        name: record.name.as_deref().unwrap_or("Task").trim().to_string(),
        notes: record.notes,
        due_on: record.due_on,
        due_at: record.due_at,
        completed: record.completed,
        assignee: record.assignee,
        custom_fields: record.custom_fields,
    };

    Json(payload).into_response()
}

pub async fn list_task_stories(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(task_gid): Path<String>,
    Query(query): Query<ConnectionQuery>,
) -> Response {
    let user_id = match parse_user_id(&claims) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    if let Err(resp) = ensure_workspace_plan_membership(&state, user_id).await {
        return resp;
    }

    let (access_token, _) = match ensure_asana_token(&state, user_id, &query).await {
        Ok(token) => token,
        Err(resp) => return resp,
    };

    match fetch_task_stories(&state, &access_token, task_gid.trim()).await {
        Ok(stories) => Json(StoriesResponse {
            success: true,
            stories,
        })
        .into_response(),
        Err(resp) => resp,
    }
}

#[allow(clippy::result_large_err)]
fn parse_user_id(claims: &Claims) -> Result<Uuid, Response> {
    Uuid::parse_str(&claims.id)
        .map_err(|_| JsonResponse::unauthorized("Invalid user identifier").into_response())
}

#[allow(clippy::result_large_err)]
fn determine_scope(query: &ConnectionQuery) -> Result<RequestedScope, Response> {
    if let Some(scope) = query.scope.as_deref() {
        if scope.eq_ignore_ascii_case("workspace") {
            let connection_id = query.connection_id.ok_or_else(|| {
                JsonResponse::bad_request(
                    "Connection ID is required when using a workspace credential",
                )
                .into_response()
            })?;
            return Ok(RequestedScope::Workspace(connection_id));
        }

        if scope.eq_ignore_ascii_case("personal") {
            return Ok(RequestedScope::Personal);
        }

        return Err(JsonResponse::bad_request("Unsupported connection scope").into_response());
    }

    if let Some(connection_id) = query.connection_id {
        return Ok(RequestedScope::Workspace(connection_id));
    }

    Ok(RequestedScope::Personal)
}

async fn ensure_asana_token(
    state: &AppState,
    user_id: Uuid,
    query: &ConnectionQuery,
) -> Result<(String, Option<Uuid>), Response> {
    match determine_scope(query)? {
        RequestedScope::Workspace(connection_id) => {
            ensure_workspace_token(state, user_id, connection_id)
                .await
                .map(|token| (token, Some(connection_id)))
        }
        RequestedScope::Personal => Err(JsonResponse::bad_request(
            "Personal scope requires an explicit OAuth connection",
        )
        .into_response()),
    }
}

async fn ensure_workspace_token(
    state: &AppState,
    user_id: Uuid,
    connection_id: Uuid,
) -> Result<String, Response> {
    let connections = state
        .workspace_connection_repo
        .list_for_user_memberships(user_id)
        .await
        .map_err(|err| {
            error!(?err, "Failed to load workspace OAuth connections");
            JsonResponse::server_error("Failed to load workspace connection").into_response()
        })?;

    let listing = connections
        .into_iter()
        .find(|connection| {
            connection.id == connection_id && connection.provider == ConnectedOAuthProvider::Asana
        })
        .ok_or_else(|| {
            JsonResponse::not_found("Selected workspace Asana connection is no longer available")
                .into_response()
        })?;

    let workspace_id = listing.workspace_id;

    if let Err(msg) = ensure_workspace_plan(state, workspace_id).await {
        return Err(JsonResponse::forbidden(&msg).into_response());
    }

    if let Err(msg) = ensure_run_membership(state, workspace_id, user_id).await {
        return Err(JsonResponse::forbidden(&msg).into_response());
    };

    state
        .workspace_oauth
        .ensure_valid_workspace_token(listing.id)
        .await
        .map_err(map_workspace_oauth_error)
        .and_then(|connection| {
            if connection.workspace_id != workspace_id {
                return Err(JsonResponse::not_found(
                    "Selected workspace Asana connection is no longer available",
                )
                .into_response());
            }

            Ok(connection.access_token)
        })
}

async fn fetch_workspaces(
    state: &AppState,
    access_token: &str,
) -> Result<Vec<WorkspacePayload>, Response> {
    let url = format!("{ASANA_BASE_URL}/workspaces");
    let records: ListResponse<WorkspaceRecord> = get_json(state, access_token, &url).await?;

    Ok(records
        .data
        .into_iter()
        .filter(|record| !record.gid.trim().is_empty())
        .map(|record| WorkspacePayload {
            gid: record.gid.trim().to_string(),
            name: record
                .name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("Workspace")
                .to_string(),
        })
        .collect())
}

async fn fetch_projects(
    state: &AppState,
    access_token: &str,
    workspace_gid: &str,
) -> Result<Vec<ProjectPayload>, Response> {
    if workspace_gid.is_empty() {
        return Ok(Vec::new());
    }

    let url = format!("{ASANA_BASE_URL}/workspaces/{workspace_gid}/projects");
    let records: ListResponse<ProjectRecord> = get_json(state, access_token, &url).await?;

    Ok(records
        .data
        .into_iter()
        .filter(|record| !record.gid.trim().is_empty())
        .map(|record| ProjectPayload {
            gid: record.gid.trim().to_string(),
            name: record
                .name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("Project")
                .to_string(),
        })
        .collect())
}

async fn fetch_tags(
    state: &AppState,
    access_token: &str,
    workspace_gid: &str,
) -> Result<Vec<TagPayload>, Response> {
    if workspace_gid.is_empty() {
        return Ok(Vec::new());
    }

    let url = format!("{ASANA_BASE_URL}/workspaces/{workspace_gid}/tags");
    let records: ListResponse<TagRecord> = get_json(state, access_token, &url).await?;

    Ok(records
        .data
        .into_iter()
        .filter(|record| !record.gid.trim().is_empty())
        .map(|record| TagPayload {
            gid: record.gid.trim().to_string(),
            name: record
                .name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("Tag")
                .to_string(),
        })
        .collect())
}

async fn fetch_sections(
    state: &AppState,
    access_token: &str,
    project_gid: &str,
) -> Result<Vec<SectionPayload>, Response> {
    if project_gid.is_empty() {
        return Ok(Vec::new());
    }

    let url = format!("{ASANA_BASE_URL}/projects/{project_gid}/sections");
    let records: ListResponse<SectionRecord> = get_json(state, access_token, &url).await?;

    Ok(records
        .data
        .into_iter()
        .filter(|record| !record.gid.trim().is_empty())
        .map(|record| SectionPayload {
            gid: record.gid.trim().to_string(),
            name: record
                .name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("Section")
                .to_string(),
        })
        .collect())
}

async fn fetch_teams(
    state: &AppState,
    access_token: &str,
    workspace_gid: &str,
) -> Result<Vec<TeamPayload>, Response> {
    if workspace_gid.is_empty() {
        return Ok(Vec::new());
    }

    // Organizations expose teams; some personal workspaces may return an error, which we treat as empty.
    let url = format!("{ASANA_BASE_URL}/organizations/{workspace_gid}/teams");
    match get_json::<ListResponse<TeamRecord>>(state, access_token, &url).await {
        Ok(records) => Ok(records
            .data
            .into_iter()
            .filter(|record| !record.gid.trim().is_empty())
            .map(|record| TeamPayload {
                gid: record.gid.trim().to_string(),
                name: record
                    .name
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("Team")
                    .to_string(),
            })
            .collect()),
        Err(resp) => {
            if resp.status().as_u16() == StatusCode::NOT_FOUND.as_u16() {
                Ok(Vec::new())
            } else {
                Err(resp)
            }
        }
    }
}

async fn fetch_users(
    state: &AppState,
    access_token: &str,
    workspace_gid: &str,
    team_gid: Option<&str>,
) -> Result<Vec<UserPayload>, Response> {
    if workspace_gid.is_empty() {
        return Ok(Vec::new());
    }

    let mut url = format!("{ASANA_BASE_URL}/users?workspace={workspace_gid}");
    if let Some(team) = team_gid {
        if !team.trim().is_empty() {
            url.push_str(&format!("&team={}", urlencoding::encode(team.trim())));
        }
    }
    url.push_str("&opt_fields=email,name");

    let records: ListResponse<UserRecord> = get_json(state, access_token, &url).await?;

    Ok(records
        .data
        .into_iter()
        .filter(|record| !record.gid.trim().is_empty())
        .map(|record| UserPayload {
            gid: record.gid.trim().to_string(),
            name: record
                .name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("User")
                .to_string(),
            email: record
                .email
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(String::from),
        })
        .collect())
}

async fn fetch_tasks(
    state: &AppState,
    access_token: &str,
    project_gid: &str,
) -> Result<Vec<TaskPayload>, Response> {
    let trimmed = project_gid.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let url = format!(
        "{ASANA_BASE_URL}/tasks?opt_fields=name,notes,due_on,due_at,completed,assignee.gid,assignee.name,assignee.emailcustom_fields,custom_fields.name,custom_fields.type,custom_fields.text_value,custom_fields.number_value,custom_fields.enum_value.name&limit=50&project={}",
        urlencoding::encode(trimmed)
    );

    let records: ListResponse<TaskRecord> = get_json(state, access_token, &url).await?;

    Ok(records
        .data
        .into_iter()
        .filter(|r| !r.gid.trim().is_empty())
        .map(|r| TaskPayload {
            gid: r.gid.trim().to_string(),
            name: r
                .name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("Task")
                .to_string(),
            notes: r.notes,
            due_on: r.due_on,
            due_at: r.due_at,
            completed: r.completed,
            assignee: r.assignee,
            custom_fields: r.custom_fields,
        })
        .collect())
}

async fn fetch_task_stories(
    state: &AppState,
    access_token: &str,
    task_gid: &str,
) -> Result<Vec<StoryPayload>, Response> {
    if task_gid.is_empty() {
        return Ok(Vec::new());
    }

    let url = format!("{ASANA_BASE_URL}/tasks/{task_gid}/stories?opt_fields=text,resource_subtype");
    let records: ListResponse<StoryRecord> = get_json(state, access_token, &url).await?;

    Ok(records
        .data
        .into_iter()
        .filter(|record| {
            !record.gid.trim().is_empty()
                && record
                    .resource_subtype
                    .as_deref()
                    .map(str::trim)
                    .map(|s| {
                        matches!(
                            s.trim().to_ascii_lowercase().as_str(),
                            "comment" | "comment_added"
                        )
                    })
                    .unwrap_or(false)
        })
        .map(|record| StoryPayload {
            gid: record.gid.trim().to_string(),
            text: record
                .text
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("Comment")
                .to_string(),
        })
        .collect())
}
async fn get_json<T: for<'de> Deserialize<'de>>(
    state: &AppState,
    access_token: &str,
    url: &str,
) -> Result<T, Response> {
    let response = state
        .http_client
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|err| {
            error!(?err, "Failed to call Asana");
            JsonResponse::server_error("Failed to contact Asana").into_response()
        })?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        error!(%status, body, "Asana request failed");
        return Err(
            if status == ReqStatusCode::UNAUTHORIZED || status == ReqStatusCode::FORBIDDEN {
                JsonResponse::unauthorized(
                    "The Asana connection no longer has permission. Reconnect in Settings.",
                )
                .into_response()
            } else {
                JsonResponse::server_error("Failed to load Asana data").into_response()
            },
        );
    }

    serde_json::from_str::<T>(&body).map_err(|err| {
        error!(?err, body, "Failed to parse Asana response");
        JsonResponse::server_error("Received an unexpected response from Asana").into_response()
    })
}

fn map_workspace_oauth_error(err: WorkspaceOAuthError) -> Response {
    match err {
        WorkspaceOAuthError::Forbidden => {
            JsonResponse::forbidden("Not authorized to use this workspace connection")
                .into_response()
        }
        WorkspaceOAuthError::NotFound => {
            JsonResponse::not_found("Selected workspace Asana connection is no longer available")
                .into_response()
        }
        WorkspaceOAuthError::Database(error) => {
            error!(?error, "Workspace connection database error");
            JsonResponse::server_error("Failed to load workspace connection").into_response()
        }
        WorkspaceOAuthError::Encryption(error) => {
            error!(?error, "Workspace connection decryption error");
            JsonResponse::server_error("Failed to load workspace connection").into_response()
        }
        WorkspaceOAuthError::OAuth(error) => map_oauth_error(error),
    }
}

fn has_workspace_plan_membership(memberships: &[WorkspaceMembershipSummary]) -> bool {
    memberships.iter().any(|membership| {
        !NormalizedPlanTier::from_option(Some(membership.workspace.plan.as_str())).is_solo()
    })
}

async fn ensure_workspace_plan_membership(state: &AppState, user_id: Uuid) -> Result<(), Response> {
    let memberships = state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await
        .map_err(|err| {
            error!(?err, %user_id, "Failed to load workspace memberships");
            JsonResponse::server_error("Failed to verify workspace access").into_response()
        })?;

    if has_workspace_plan_membership(&memberships) {
        return Ok(());
    }

    Err(JsonResponse::forbidden("Asana is only available on the Workspace plan").into_response())
}
