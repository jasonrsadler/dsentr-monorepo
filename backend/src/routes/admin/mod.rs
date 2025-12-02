use std::collections::HashMap;

use axum::{
    body::Body,
    extract::{FromRequestParts, Path, Query, State},
    http::Request,
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{postgres::PgRow, FromRow, Postgres, QueryBuilder, Row};
use time::OffsetDateTime;
use tracing::error;
use uuid::Uuid;

use crate::{
    models::{
        issue_report::{IssueReport, IssueReportMessage},
        oauth_token::ConnectedOAuthProvider,
        user::UserRole,
        workflow::Workflow,
        workspace::{Workspace, WorkspaceInvitation, WorkspaceMember},
    },
    responses::JsonResponse,
    routes::{
        auth::session::AuthSession,
        issues::fetch_issue_messages,
    },
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    page: Option<i64>,
    limit: Option<i64>,
    search: Option<String>,
    sort_by: Option<String>,
    order: Option<String>,
}

#[derive(Debug, Serialize)]
struct PaginatedResponse<T> {
    data: Vec<T>,
    total: i64,
    page: i64,
    limit: i64,
}

#[derive(Debug, Serialize, FromRow)]
struct AdminUserRow {
    id: Uuid,
    email: String,
    plan: Option<String>,
    is_verified: bool,
    is_admin: bool,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
}

#[derive(Debug, Serialize, FromRow)]
struct AdminUserDetailRow {
    id: Uuid,
    email: String,
    plan: Option<String>,
    role: Option<UserRole>,
    is_verified: bool,
    company_name: Option<String>,
    settings: Value,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    onboarded_at: Option<OffsetDateTime>,
}

#[derive(Debug, Serialize, FromRow)]
struct ConnectionSummary {
    id: Uuid,
    provider: ConnectedOAuthProvider,
    account_email: String,
    workspace_id: Option<Uuid>,
    owner_user_id: Uuid,
    scope: String,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
}

#[derive(Debug, Serialize, FromRow)]
struct WorkspaceListRow {
    id: Uuid,
    name: String,
    plan: String,
    owner_id: Uuid,
    owner_email: Option<String>,
    member_count: i64,
    run_count: i64,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
}

#[derive(Debug, Serialize, FromRow)]
struct WorkflowListRow {
    id: Uuid,
    workspace_id: Option<Uuid>,
    name: String,
    run_count: i64,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
}

#[derive(Debug, Serialize, FromRow)]
struct IssueListRow {
    id: Uuid,
    user_id: Uuid,
    workspace_id: Option<Uuid>,
    status: String,
    user_email: String,
    unread_user_messages: i64,
    #[serde(with = "time::serde::rfc3339::option")]
    last_message_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
struct IssueDetailResponse {
    issue: IssueReport,
    messages: Vec<IssueReportMessage>,
    unread_user_messages: i64,
}

#[derive(Debug, Serialize, FromRow)]
struct RunSummaryRow {
    id: Uuid,
    workflow_id: Uuid,
    status: String,
    #[serde(with = "time::serde::rfc3339::option")]
    started_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    finished_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
pub struct IssueReplyPayload {
    message: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/purge-runs", post(purge_runs))
        .route("/users", get(list_users))
        .route("/users/{id}", get(get_user))
        .route("/users/{id}/workspaces", get(list_user_workspaces))
        .route("/users/{id}/connections", get(list_user_connections))
        .route("/workspaces", get(list_workspaces))
        .route("/workspaces/{id}", get(get_workspace))
        .route("/workspaces/{id}/members", get(list_workspace_members))
        .route("/workspaces/{id}/workflows", get(list_workspace_workflows))
        .route("/workspaces/{id}/issues", get(list_workspace_issues))
        .route("/workflows", get(list_workflows))
        .route("/workflows/{id}", get(get_workflow))
        .route("/workflows/{id}/runs", get(list_workflow_runs))
        .route("/workflows/{id}/json", get(get_workflow_json))
        .route("/issues", get(list_issues))
        .route("/issues/{id}", get(get_issue))
        .route("/issues/{id}/read", post(mark_issue_read))
        .route("/issues/{id}/reply", post(reply_to_issue))
        .route_layer(axum::middleware::from_fn(admin_gate))
        .layer(axum::middleware::from_fn(ip_allowlist_stub))
}

async fn admin_gate(req: Request<Body>, next: Next) -> Result<Response, Response> {
    let (mut parts, body) = req.into_parts();
    let claims = match AuthSession::from_request_parts(&mut parts, &()).await {
        Ok(AuthSession(claims)) => claims,
        Err(_) => return Err(JsonResponse::unauthorized("Session is required").into_response()),
    };

    if !matches!(claims.role, Some(UserRole::Admin)) {
        return Err(JsonResponse::forbidden("Access denied. Admins only.").into_response());
    }

    let req = Request::from_parts(parts, body);
    Ok(next.run(req).await)
}

async fn ip_allowlist_stub(req: Request<Body>, next: Next) -> Result<Response, Response> {
    // TODO: enforce IP allowlist for admin endpoints once ops provisions ranges.
    Ok(next.run(req).await)
}

fn pagination(query: &ListQuery) -> (i64, i64) {
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * limit;
    (limit, offset)
}

fn sort_parts(query: &ListQuery, allowed: &[&str], default: &str) -> (String, &'static str) {
    let sort = query
        .sort_by
        .as_deref()
        .filter(|v| allowed.iter().any(|item| item == v))
        .unwrap_or(default)
        .to_string();
    let dir = query
        .order
        .as_deref()
        .map(|v| v.eq_ignore_ascii_case("asc"))
        .unwrap_or(false);
    let direction = if dir { "ASC" } else { "DESC" };
    (sort, direction)
}

pub async fn list_users(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<impl IntoResponse, Response> {
    let (limit, offset) = pagination(&query);
    let (sort_col, sort_dir) = sort_parts(&query, &["created_at", "updated_at"], "created_at");
    let order_column = if sort_col == "updated_at" {
        "w.updated_at"
    } else {
        "w.created_at"
    };

    let mut list_builder = QueryBuilder::<Postgres>::new(
        "SELECT id, email, plan, is_verified, lower(role::text) = 'admin' as is_admin, created_at, updated_at FROM users",
    );
    let mut count_builder = QueryBuilder::<Postgres>::new("SELECT COUNT(*) as count FROM users");

    if let Some(search) = query.search.as_ref().filter(|s| !s.is_empty()) {
        let term = format!("%{}%", search);
        list_builder.push(" WHERE email ILIKE ").push_bind(term.clone());
        count_builder.push(" WHERE email ILIKE ").push_bind(term);
    }

    list_builder
        .push(" ORDER BY ")
        .push(order_column)
        .push(" ")
        .push(sort_dir)
        .push(" LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);

    let rows: Vec<AdminUserRow> = list_builder
        .build_query_as()
        .fetch_all(state.db_pool.as_ref())
        .await
        .map_err(|err| {
            error!(?err, "admin list_users failed to fetch rows");
            JsonResponse::server_error("Failed to load users").into_response()
        })?;

    let total: i64 = count_builder
        .build()
        .fetch_one(state.db_pool.as_ref())
        .await
        .map(|row: PgRow| row.get::<i64, _>("count"))
        .map_err(|err| {
            error!(?err, "admin list_users failed to count rows");
            JsonResponse::server_error("Failed to count users").into_response()
        })?;

    Ok(Json(PaginatedResponse {
        data: rows,
        total,
        page: query.page.unwrap_or(1).max(1),
        limit,
    }))
}

pub async fn get_user(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<impl IntoResponse, Response> {
    let query = r#"
        SELECT
            id,
            email,
            plan,
            role,
            is_verified,
            company_name,
            settings,
            created_at,
            updated_at,
            onboarded_at
        FROM users
        WHERE id = $1
    "#;

    let user: Option<AdminUserDetailRow> = sqlx::query_as(query)
        .bind(user_id)
        .fetch_optional(state.db_pool.as_ref())
        .await
        .map_err(|_| JsonResponse::server_error("Failed to load user").into_response())?;

    let Some(user) = user else {
        return Err(JsonResponse::not_found("User not found").into_response());
    };

    Ok(Json(user))
}

pub async fn list_user_workspaces(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<impl IntoResponse, Response> {
    let workspaces = state
        .workspace_repo
        .list_memberships_for_user(user_id)
        .await
        .map_err(|_| JsonResponse::server_error("Failed to load workspaces").into_response())?;

    Ok(Json(workspaces))
}

pub async fn list_user_connections(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<impl IntoResponse, Response> {
    let personal_query = r#"
        SELECT id, provider, account_email, workspace_id, user_id as owner_user_id, 'personal' AS scope, updated_at
        FROM user_oauth_tokens
        WHERE user_id = $1 AND workspace_id IS NULL
    "#;

    let workspace_query = r#"
        SELECT id, provider, account_email, workspace_id, owner_user_id, 'workspace' AS scope, updated_at
        FROM workspace_connections
        WHERE owner_user_id = $1
    "#;

    let mut connections: Vec<ConnectionSummary> = sqlx::query_as(personal_query)
        .bind(user_id)
        .fetch_all(state.db_pool.as_ref())
        .await
        .map_err(|_| JsonResponse::server_error("Failed to load user connections").into_response())?;

    let mut workspace_connections: Vec<ConnectionSummary> = sqlx::query_as(workspace_query)
        .bind(user_id)
        .fetch_all(state.db_pool.as_ref())
        .await
        .map_err(|_| JsonResponse::server_error("Failed to load workspace connections").into_response())?;

    connections.append(&mut workspace_connections);

    Ok(Json(connections))
}

pub async fn list_workspaces(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<impl IntoResponse, Response> {
    let (limit, offset) = pagination(&query);
    let (sort_col, sort_dir) = sort_parts(&query, &["created_at", "updated_at"], "created_at");

    let mut list_builder = QueryBuilder::<Postgres>::new(
        r#"
        SELECT
            w.id,
            w.name,
            w.plan,
            w.owner_id,
            u.email as owner_email,
            COALESCE((SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id), 0) as member_count,
            COALESCE((SELECT COUNT(*) FROM workflow_runs wr WHERE wr.workspace_id = w.id), 0) as run_count,
            w.created_at,
            w.updated_at
        FROM workspaces w
        LEFT JOIN users u ON u.id = w.owner_id
        "#,
    );
    let mut count_builder =
        QueryBuilder::<Postgres>::new("SELECT COUNT(*) as count FROM workspaces w");

    if let Some(search) = query.search.as_ref().filter(|s| !s.is_empty()) {
        let term = format!("%{}%", search);
        list_builder
            .push(" WHERE (w.name ILIKE ")
            .push_bind(term.clone())
            .push(" OR u.email ILIKE ")
            .push_bind(term.clone())
            .push(")");
        count_builder
            .push(" LEFT JOIN users u ON u.id = w.owner_id WHERE (w.name ILIKE ")
            .push_bind(term.clone())
            .push(" OR u.email ILIKE ")
            .push_bind(term)
            .push(")");
    }

    list_builder
        .push(" ORDER BY ")
        .push(sort_col)
        .push(" ")
        .push(sort_dir)
        .push(" LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);

    let rows: Vec<WorkspaceListRow> = list_builder
        .build_query_as()
        .fetch_all(state.db_pool.as_ref())
        .await
        .map_err(|_| JsonResponse::server_error("Failed to load workspaces").into_response())?;

    let total: i64 = count_builder
        .build()
        .fetch_one(state.db_pool.as_ref())
        .await
        .map(|row: PgRow| row.get::<i64, _>("count"))
        .map_err(|_| JsonResponse::server_error("Failed to count workspaces").into_response())?;

    Ok(Json(PaginatedResponse {
        data: rows,
        total,
        page: query.page.unwrap_or(1).max(1),
        limit,
    }))
}

pub async fn get_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<Uuid>,
) -> Result<impl IntoResponse, Response> {
    let workspace: Option<Workspace> = state
        .workspace_repo
        .find_workspace(workspace_id)
        .await
        .map_err(|_| JsonResponse::server_error("Failed to load workspace").into_response())?;

    let Some(workspace) = workspace else {
        return Err(JsonResponse::not_found("Workspace not found").into_response());
    };

    let invites: Vec<WorkspaceInvitation> = state
        .workspace_repo
        .list_workspace_invitations(workspace_id)
        .await
        .unwrap_or_default();

    let sanitized_invites: Vec<Value> = invites
        .into_iter()
        .map(|invite| {
            serde_json::json!({
                "id": invite.id,
                "workspace_id": invite.workspace_id,
                "email": invite.email,
                "role": invite.role,
                "status": invite.status,
                "expires_at": invite.expires_at,
                "created_at": invite.created_at,
                "accepted_at": invite.accepted_at,
                "revoked_at": invite.revoked_at,
                "declined_at": invite.declined_at
            })
        })
        .collect();

    let connections = state
        .workspace_connection_repo
        .list_for_workspace(workspace_id)
        .await
        .unwrap_or_default();

    let workflows = state
        .workflow_repo
        .list_workflows_by_workspace_ids(&[workspace_id])
        .await
        .unwrap_or_default();

    let run_counts = fetch_run_counts(
        &state,
        workflows.iter().map(|wf| wf.id).collect::<Vec<Uuid>>(),
    )
    .await;

    let issues = fetch_issues_for_workspace(&state, workspace_id).await?;

    let response = serde_json::json!({
        "workspace": workspace,
        "invites": sanitized_invites,
        "connections": connections,
        "workflows": workflows.iter().map(|wf| {
            serde_json::json!({
                "id": wf.id,
                "workspace_id": wf.workspace_id,
                "name": wf.name,
                "updated_at": wf.updated_at,
                "run_count": run_counts.get(&wf.id).copied().unwrap_or_default(),
            })
        }).collect::<Vec<_>>(),
        "issues": issues,
        "quotas": {
            "member_limit": state.config.workspace_member_limit,
            "run_limit": state.config.workspace_monthly_run_limit
        }
    });

    Ok(Json(response))
}

pub async fn list_workspace_members(
    State(state): State<AppState>,
    Path(workspace_id): Path<Uuid>,
) -> Result<impl IntoResponse, Response> {
    let members: Vec<WorkspaceMember> = state
        .workspace_repo
        .list_members(workspace_id)
        .await
        .map_err(|_| JsonResponse::server_error("Failed to load members").into_response())?;

    Ok(Json(members))
}

pub async fn list_workspace_workflows(
    State(state): State<AppState>,
    Path(workspace_id): Path<Uuid>,
) -> Result<impl IntoResponse, Response> {
    let workflows = state
        .workflow_repo
        .list_workflows_by_workspace_ids(&[workspace_id])
        .await
        .unwrap_or_default();

    let run_counts = fetch_run_counts(&state, workflows.iter().map(|wf| wf.id).collect()).await;

    let data: Vec<Value> = workflows
        .into_iter()
        .map(|wf| {
            let run_count = run_counts
                .get(&wf.id)
                .copied()
                .unwrap_or_default();
            serde_json::json!({
                "id": wf.id,
                "workspace_id": wf.workspace_id,
                "name": wf.name,
                "updated_at": wf.updated_at,
                "run_count": run_count,
            })
        })
        .collect();

    Ok(Json(data))
}

pub async fn list_workspace_issues(
    State(state): State<AppState>,
    Path(workspace_id): Path<Uuid>,
) -> Result<impl IntoResponse, Response> {
    let issues = fetch_issues_for_workspace(&state, workspace_id).await?;
    Ok(Json(issues))
}

pub async fn list_workflows(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<impl IntoResponse, Response> {
    let (limit, offset) = pagination(&query);
    let (sort_col, sort_dir) = sort_parts(&query, &["created_at", "updated_at"], "updated_at");
    let order_column = if sort_col == "created_at" {
        "w.created_at"
    } else {
        "w.updated_at"
    };

    let mut list_builder = QueryBuilder::<Postgres>::new(
        r#"
        SELECT
            w.id,
            w.workspace_id,
            w.name,
            COALESCE(run_counts.count, 0) as run_count,
            w.updated_at
        FROM workflows w
        LEFT JOIN (
            SELECT workflow_id, COUNT(*) as count
            FROM workflow_runs
            GROUP BY workflow_id
        ) as run_counts ON run_counts.workflow_id = w.id
        "#,
    );
    let mut count_builder =
        QueryBuilder::<Postgres>::new("SELECT COUNT(*) as count FROM workflows w");

    if let Some(search) = query.search.as_ref().filter(|s| !s.is_empty()) {
        let term = format!("%{}%", search);
        list_builder
            .push(" WHERE w.name ILIKE ")
            .push_bind(term.clone());
        count_builder
            .push(" WHERE w.name ILIKE ")
            .push_bind(term);
    }

    list_builder
        .push(" ORDER BY ")
        .push(order_column)
        .push(" ")
        .push(sort_dir)
        .push(" LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);

    let rows: Vec<WorkflowListRow> = list_builder
        .build_query_as()
        .fetch_all(state.db_pool.as_ref())
        .await
        .map_err(|_| JsonResponse::server_error("Failed to load workflows").into_response())?;

    let total: i64 = count_builder
        .build()
        .fetch_one(state.db_pool.as_ref())
        .await
        .map(|row: PgRow| row.get::<i64, _>("count"))
        .map_err(|_| JsonResponse::server_error("Failed to count workflows").into_response())?;

    Ok(Json(PaginatedResponse {
        data: rows,
        total,
        page: query.page.unwrap_or(1).max(1),
        limit,
    }))
}

pub async fn get_workflow(
    State(state): State<AppState>,
    Path(workflow_id): Path<Uuid>,
) -> Result<impl IntoResponse, Response> {
    let workflow: Option<Workflow> = state
        .workflow_repo
        .find_workflow_by_id_public(workflow_id)
        .await
        .map_err(|_| JsonResponse::server_error("Failed to load workflow").into_response())?;

    let Some(workflow) = workflow else {
        return Err(JsonResponse::not_found("Workflow not found").into_response());
    };

    let run_count: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM workflow_runs WHERE workflow_id = $1",
    )
    .bind(workflow_id)
    .fetch_one(state.db_pool.as_ref())
    .await
    .unwrap_or(0);

    let runs = fetch_recent_runs(&state, workflow_id, 25).await?;

    let response = serde_json::json!({
        "id": workflow.id,
        "workspace_id": workflow.workspace_id,
        "name": workflow.name,
        "updated_at": workflow.updated_at,
        "run_count": run_count,
        "runs": runs,
    });

    Ok(Json(response))
}

pub async fn list_workflow_runs(
    State(state): State<AppState>,
    Path(workflow_id): Path<Uuid>,
) -> Result<impl IntoResponse, Response> {
    let runs = fetch_recent_runs(&state, workflow_id, 50).await?;
    Ok(Json(runs))
}

pub async fn get_workflow_json(
    State(state): State<AppState>,
    Path(workflow_id): Path<Uuid>,
) -> Result<impl IntoResponse, Response> {
    let workflow: Option<Workflow> = state
        .workflow_repo
        .find_workflow_by_id_public(workflow_id)
        .await
        .map_err(|_| JsonResponse::server_error("Failed to load workflow").into_response())?;

    let Some(workflow) = workflow else {
        return Err(JsonResponse::not_found("Workflow not found").into_response());
    };

    Ok(Json(workflow.data))
}

pub async fn list_issues(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<impl IntoResponse, Response> {
    let (limit, offset) = pagination(&query);
    let (sort_col, sort_dir) = sort_parts(&query, &["created_at", "updated_at"], "updated_at");
    let sort_col_alias = match sort_col.as_str() {
        "created_at" | "updated_at" => format!("ir.{sort_col}"),
        other => other.to_string(),
    };

    let mut list_builder = QueryBuilder::<Postgres>::new(
        r#"
        SELECT ir.id,
               ir.user_id,
               ir.workspace_id,
               ir.status,
               ir.user_email,
               COALESCE(unread.count, 0) AS unread_user_messages,
               COALESCE(last_msg.created_at, ir.created_at) AS last_message_at,
               ir.created_at,
               ir.updated_at
        FROM issue_reports ir
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::BIGINT AS count
            FROM issue_report_messages m
            WHERE m.issue_id = ir.id
              AND m.sender_type = 'user'
              AND m.read_by_admin_at IS NULL
        ) unread ON TRUE
        LEFT JOIN LATERAL (
            SELECT created_at
            FROM issue_report_messages m
            WHERE m.issue_id = ir.id
            ORDER BY created_at DESC
            LIMIT 1
        ) last_msg ON TRUE
        "#,
    );
    let mut count_builder =
        QueryBuilder::<Postgres>::new("SELECT COUNT(*) as count FROM issue_reports");

    if let Some(search) = query.search.as_ref().filter(|s| !s.is_empty()) {
        let term = format!("%{}%", search);
        list_builder
            .push(" WHERE (ir.user_email ILIKE ")
            .push_bind(term.clone())
            .push(" OR ir.status ILIKE ")
            .push_bind(term.clone())
            .push(")");
        count_builder
            .push(" WHERE (user_email ILIKE ")
            .push_bind(term.clone())
            .push(" OR status ILIKE ")
            .push_bind(term)
            .push(")");
    }

    list_builder
        .push(" ORDER BY ")
        .push(sort_col_alias.as_str())
        .push(" ")
        .push(sort_dir)
        .push(" LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);

    let rows: Vec<IssueListRow> = list_builder
        .build_query_as()
        .fetch_all(state.db_pool.as_ref())
        .await
        .map_err(|_| JsonResponse::server_error("Failed to load issues").into_response())?;

    let total: i64 = count_builder
        .build()
        .fetch_one(state.db_pool.as_ref())
        .await
        .map(|row: PgRow| row.get::<i64, _>("count"))
        .map_err(|_| JsonResponse::server_error("Failed to count issues").into_response())?;

    Ok(Json(PaginatedResponse {
        data: rows,
        total,
        page: query.page.unwrap_or(1).max(1),
        limit,
    }))
}

pub async fn get_issue(
    State(state): State<AppState>,
    Path(issue_id): Path<Uuid>,
) -> Result<impl IntoResponse, Response> {
    let issue: Option<IssueReport> = sqlx::query_as(
        r#"
        SELECT id, user_id, workspace_id, user_email, user_name, user_plan, user_role,
               workspace_plan, workspace_role, description, metadata, created_at, status, updated_at
        FROM issue_reports
        WHERE id = $1
        "#,
    )
    .bind(issue_id)
    .fetch_optional(state.db_pool.as_ref())
    .await
    .map_err(|_| JsonResponse::server_error("Failed to load issue").into_response())?;

    let Some(issue) = issue else {
        return Err(JsonResponse::not_found("Issue not found").into_response());
    };

    mark_issue_read_internal(&state, issue_id).await.ok();

    let messages = fetch_issue_messages(&state, issue_id, &issue).await?;
    let unread_user_messages = messages
        .iter()
        .filter(|msg| msg.sender_type == "user" && msg.read_by_admin_at.is_none())
        .count() as i64;

    Ok(Json(IssueDetailResponse {
        issue,
        messages,
        unread_user_messages,
    }))
}

pub async fn reply_to_issue(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(issue_id): Path<Uuid>,
    Json(payload): Json<IssueReplyPayload>,
) -> Result<impl IntoResponse, Response> {
    let message = payload.message.trim();
    if message.is_empty() {
        return Err(JsonResponse::bad_request("Message is required").into_response());
    }
    if message.len() > 4000 {
        return Err(JsonResponse::bad_request("Message is too long").into_response());
    }

    let issue: Option<IssueReport> = sqlx::query_as(
        r#"
        SELECT id, user_id, workspace_id, user_email, user_name, user_plan, user_role,
               workspace_plan, workspace_role, description, metadata, created_at, status, updated_at
        FROM issue_reports
        WHERE id = $1
        "#,
    )
    .bind(issue_id)
    .fetch_optional(state.db_pool.as_ref())
    .await
    .map_err(|_| JsonResponse::server_error("Failed to load issue").into_response())?;

    let Some(issue) = issue else {
        return Err(JsonResponse::not_found("Issue not found").into_response());
    };

    let admin_id = Uuid::parse_str(&claims.id).ok();
    let now = OffsetDateTime::now_utc();

    let _ = sqlx::query(
        r#"
        UPDATE issue_report_messages
        SET read_by_admin_at = COALESCE(read_by_admin_at, $2)
        WHERE issue_id = $1
          AND sender_type = 'user'
          AND read_by_admin_at IS NULL
        "#,
    )
    .bind(issue_id)
    .bind(now)
    .execute(state.db_pool.as_ref())
    .await;

    let insert_query = r#"
        INSERT INTO issue_report_messages (issue_id, sender_id, sender_type, body, read_by_admin_at)
        VALUES ($1, $2, 'admin', $3, $4)
        RETURNING id, issue_id, sender_id, sender_type, body, created_at, read_by_user_at, read_by_admin_at
    "#;

    let _message_row: IssueReportMessage = sqlx::query_as(insert_query)
        .bind(issue_id)
        .bind(admin_id)
        .bind(message)
        .bind(now)
        .fetch_one(state.db_pool.as_ref())
        .await
        .map_err(|_| JsonResponse::server_error("Failed to store reply").into_response())?;

    let _ = sqlx::query(
        "UPDATE issue_reports SET status = 'waiting_user', updated_at = now() WHERE id = $1",
    )
    .bind(issue_id)
    .execute(state.db_pool.as_ref())
    .await;

    let messages = fetch_issue_messages(&state, issue_id, &issue).await?;
    let unread_user_messages = messages
        .iter()
        .filter(|msg| msg.sender_type == "user" && msg.read_by_admin_at.is_none())
        .count() as i64;

    Ok(Json(IssueDetailResponse {
        issue,
        messages,
        unread_user_messages,
    }))
}

pub async fn purge_runs(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Json(body): Json<PurgeRunsBody>,
) -> Response {
    if !matches!(claims.role, Some(UserRole::Admin)) {
        return JsonResponse::forbidden("Access denied. Admins only.").into_response();
    }

    let days = body.days.unwrap_or_else(|| {
        std::env::var("RUN_RETENTION_DAYS")
            .ok()
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(30)
    });

    match app_state.workflow_repo.purge_old_runs(days).await {
        Ok(deleted) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!({"success": true, "deleted": deleted, "days": days })),
        )
            .into_response(),
        Err(_) => JsonResponse::server_error("Failed to purge runs").into_response(),
    }
}

pub async fn mark_issue_read(
    State(state): State<AppState>,
    Path(issue_id): Path<Uuid>,
) -> Result<impl IntoResponse, Response> {
    let unread_user_messages = mark_issue_read_internal(&state, issue_id).await?;

    Ok(Json(json!({
        "success": true,
        "unread_user_messages": unread_user_messages
    })))
}

async fn mark_issue_read_internal(
    state: &AppState,
    issue_id: Uuid,
) -> Result<i64, Response> {
    let now = OffsetDateTime::now_utc();

    let exists: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM issue_reports WHERE id = $1 LIMIT 1")
            .bind(issue_id)
            .fetch_optional(state.db_pool.as_ref())
            .await
            .map_err(|_| JsonResponse::server_error("Failed to load issue").into_response())?;

    if exists.is_none() {
        return Err(JsonResponse::not_found("Issue not found").into_response());
    }

    let _ = sqlx::query(
        r#"
        UPDATE issue_report_messages
        SET read_by_admin_at = COALESCE(read_by_admin_at, $2)
        WHERE issue_id = $1
          AND sender_type = 'user'
          AND read_by_admin_at IS NULL
        "#,
    )
    .bind(issue_id)
    .bind(now)
    .execute(state.db_pool.as_ref())
    .await;

    let unread_user_messages: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)::BIGINT
        FROM issue_report_messages
        WHERE issue_id = $1
          AND sender_type = 'user'
          AND read_by_admin_at IS NULL
        "#,
    )
    .bind(issue_id)
    .fetch_one(state.db_pool.as_ref())
    .await
    .unwrap_or(0);

    Ok(unread_user_messages)
}

async fn fetch_issues_for_workspace(
    state: &AppState,
    workspace_id: Uuid,
) -> Result<Vec<IssueListRow>, Response> {
    let rows: Vec<IssueListRow> = sqlx::query_as(
        r#"
        SELECT ir.id,
               ir.user_id,
               ir.workspace_id,
               ir.status,
               ir.user_email,
               COALESCE(unread.count, 0) AS unread_user_messages,
               COALESCE(last_msg.created_at, ir.created_at) AS last_message_at,
               ir.created_at,
               ir.updated_at
        FROM issue_reports ir
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::BIGINT AS count
            FROM issue_report_messages m
            WHERE m.issue_id = ir.id
              AND m.sender_type = 'user'
              AND m.read_by_admin_at IS NULL
        ) unread ON TRUE
        LEFT JOIN LATERAL (
            SELECT created_at
            FROM issue_report_messages m
            WHERE m.issue_id = ir.id
            ORDER BY created_at DESC
            LIMIT 1
        ) last_msg ON TRUE
        WHERE ir.workspace_id = $1
        ORDER BY ir.updated_at DESC
        "#,
    )
    .bind(workspace_id)
    .fetch_all(state.db_pool.as_ref())
    .await
    .map_err(|_| JsonResponse::server_error("Failed to load workspace issues").into_response())?;

    Ok(rows)
}

async fn fetch_recent_runs(
    state: &AppState,
    workflow_id: Uuid,
    limit: i64,
) -> Result<Vec<RunSummaryRow>, Response> {
    let rows: Vec<RunSummaryRow> = sqlx::query_as(
        r#"
        SELECT id, workflow_id, status, started_at, finished_at, created_at
        FROM workflow_runs
        WHERE workflow_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        "#,
    )
    .bind(workflow_id)
    .bind(limit)
    .fetch_all(state.db_pool.as_ref())
    .await
    .map_err(|_| JsonResponse::server_error("Failed to load workflow runs").into_response())?;

    Ok(rows)
}

async fn fetch_run_counts(
    state: &AppState,
    workflow_ids: Vec<Uuid>,
) -> HashMap<Uuid, i64> {
    if workflow_ids.is_empty() {
        return HashMap::new();
    }

    let rows: Vec<(Uuid, i64)> = sqlx::query_as::<_, (Uuid, i64)>(
        r#"
        SELECT workflow_id, COUNT(*) as count
        FROM workflow_runs
        WHERE workflow_id = ANY($1)
        GROUP BY workflow_id
        "#,
    )
    .bind(workflow_ids)
    .fetch_all(state.db_pool.as_ref())
    .await
    .unwrap_or_default();

    rows.into_iter().collect()
}

#[derive(Debug, Deserialize)]
pub struct PurgeRunsBody {
    pub days: Option<i32>,
}
