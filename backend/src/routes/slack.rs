use axum::{
    extract::{Query, State},
    response::{IntoResponse, Response},
    Json,
};
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConnectionQuery {
    scope: Option<String>,
    connection_id: Option<Uuid>,
    #[cfg(test)]
    base_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlackChannelPayload {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_private: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SlackChannelsResponse {
    success: bool,
    channels: Vec<SlackChannelPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct SlackChannelsApiResponse {
    ok: bool,
    channels: Option<Vec<SlackChannelRecord>>,
    error: Option<String>,
    response_metadata: Option<SlackResponseMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct SlackResponseMetadata {
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct SlackChannelRecord {
    id: Option<String>,
    name: Option<String>,
    is_private: Option<bool>,
    is_archived: Option<bool>,
}

pub async fn list_channels(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Query(query): Query<ConnectionQuery>,
) -> Response {
    let user_id = match parse_user_id(&claims) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    let scope = match determine_scope(&query) {
        Ok(scope) => scope,
        Err(resp) => return resp,
    };

    if scope == RequestedScope::Personal {
        if let Err(resp) = ensure_workspace_plan_membership(&state, user_id).await {
            return resp;
        }
    }

    let (access_token, workspace_id) = match scope {
        RequestedScope::Workspace(connection_id) => {
            match ensure_workspace_token(&state, user_id, connection_id).await {
                Ok((token, workspace_id)) => (token, Some(workspace_id)),
                Err(resp) => return resp,
            }
        }
        RequestedScope::Personal => {
            return JsonResponse::bad_request(
                "Personal scope requires an explicit OAuth connection",
            )
            .into_response();
        }
    };

    if let Some(workspace_id) = workspace_id {
        if let Err(msg) = ensure_workspace_plan(&state, workspace_id).await {
            return JsonResponse::forbidden(&msg).into_response();
        }

        if let Err(msg) = ensure_run_membership(&state, workspace_id, user_id).await {
            return JsonResponse::forbidden(&msg).into_response();
        };
    }

    #[cfg(test)]
    let base_override = query.base_url.as_deref();
    #[cfg(not(test))]
    let base_override: Option<&str> = None;

    let channels = match fetch_slack_channels(&state, &access_token, base_override).await {
        Ok(channels) => channels,
        Err(resp) => return resp,
    };

    Json(SlackChannelsResponse {
        success: true,
        channels,
    })
    .into_response()
}

#[allow(clippy::result_large_err)]
fn parse_user_id(claims: &Claims) -> Result<Uuid, Response> {
    Uuid::parse_str(&claims.id)
        .map_err(|_| JsonResponse::unauthorized("Invalid user identifier").into_response())
}

#[derive(Debug, PartialEq, Eq)]
enum RequestedScope {
    Personal,
    Workspace(Uuid),
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

async fn ensure_workspace_token(
    state: &AppState,
    user_id: Uuid,
    connection_id: Uuid,
) -> Result<(String, Uuid), Response> {
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
            connection.id == connection_id && connection.provider == ConnectedOAuthProvider::Slack
        })
        .ok_or_else(|| {
            JsonResponse::not_found("Selected workspace Slack connection is no longer available")
                .into_response()
        })?;

    let workspace_id = listing.workspace_id;

    state
        .workspace_oauth
        .ensure_valid_workspace_token(listing.id)
        .await
        .map_err(map_workspace_oauth_error)
        .and_then(|connection| {
            if connection.workspace_id != workspace_id {
                return Err(JsonResponse::not_found(
                    "Selected workspace Slack connection is no longer available",
                )
                .into_response());
            }

            Ok((connection.access_token, workspace_id))
        })
}

async fn fetch_slack_channels(
    state: &AppState,
    access_token: &str,
    base_override: Option<&str>,
) -> Result<Vec<SlackChannelPayload>, Response> {
    let mut collected: Vec<SlackChannelPayload> = Vec::new();
    let mut cursor: Option<String> = None;

    let base = base_override
        .map(|value| value.to_string())
        .or_else(|| std::env::var("SLACK_API_BASE_URL").ok())
        .or_else(|| std::env::var("SLACK_API_BASE").ok())
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "https://slack.com/api".to_string());
    let list_url = format!("{}/conversations.list", base.trim_end_matches('/'));

    loop {
        let mut request = state
            .http_client
            .get(&list_url)
            .bearer_auth(access_token)
            .query(&[
                ("types", "public_channel,private_channel"),
                ("limit", "200"),
            ]);

        if let Some(token) = cursor.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
            request = request.query(&[("cursor", token)]);
        }

        let response = request.send().await.map_err(|err| {
            error!(?err, "Failed to call Slack");
            JsonResponse::server_error("Failed to contact Slack").into_response()
        })?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            error!(%status, body, "Slack request failed");
            return Err(
                if status == ReqStatusCode::UNAUTHORIZED || status == ReqStatusCode::FORBIDDEN {
                    JsonResponse::unauthorized(
                        "The Slack connection no longer has permission. Reconnect in Settings.",
                    )
                    .into_response()
                } else {
                    JsonResponse::server_error("Failed to load Slack channels").into_response()
                },
            );
        }

        let parsed: SlackChannelsApiResponse = serde_json::from_str(&body).map_err(|err| {
            error!(?err, body, "Failed to parse Slack response");
            JsonResponse::server_error("Received an unexpected response from Slack").into_response()
        })?;

        if !parsed.ok {
            let message = parsed
                .error
                .as_deref()
                .unwrap_or("Slack responded with an error");
            let response = match message {
                "invalid_auth" | "not_authed" | "token_revoked" | "account_inactive" => {
                    JsonResponse::unauthorized(
                        "The Slack connection no longer has permission. Reconnect in Settings.",
                    )
                    .into_response()
                }
                other => JsonResponse::server_error(other).into_response(),
            };
            return Err(response);
        }

        if let Some(channels) = parsed.channels {
            collected.extend(channels.into_iter().filter_map(|record| {
                let id = record
                    .id
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty());
                let name = record
                    .name
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty());
                if id.is_none() || name.is_none() {
                    return None;
                }
                if record.is_archived.unwrap_or(false) {
                    return None;
                }

                Some(SlackChannelPayload {
                    id: id.unwrap().to_string(),
                    name: name.unwrap().to_string(),
                    is_private: record.is_private,
                })
            }));
        }

        cursor = parsed
            .response_metadata
            .and_then(|meta| meta.next_cursor)
            .and_then(|cursor| {
                let trimmed = cursor.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            });

        if cursor.is_none() {
            break;
        }
    }

    collected.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    collected.dedup_by(|a, b| a.id == b.id);

    Ok(collected)
}

fn map_workspace_oauth_error(err: WorkspaceOAuthError) -> Response {
    match err {
        WorkspaceOAuthError::Forbidden => {
            JsonResponse::forbidden("Not authorized to use this workspace connection")
                .into_response()
        }
        WorkspaceOAuthError::NotFound => {
            JsonResponse::not_found("Selected workspace Slack connection is no longer available")
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

    Err(JsonResponse::forbidden("Slack is only available on the Workspace plan").into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use axum::http::StatusCode as AxumStatusCode;
    use httpmock::MockServer;
    use std::sync::Arc;
    use time::{Duration, OffsetDateTime};

    use crate::config::{
        Config, OAuthProviderConfig, OAuthSettings, StripeSettings, DEFAULT_WORKSPACE_MEMBER_LIMIT,
        DEFAULT_WORKSPACE_MONTHLY_RUN_LIMIT, RUNAWAY_LIMIT_5MIN,
    };
    use crate::db::mock_db::{MockDb, NoopWorkflowRepository, StaticWorkspaceMembershipRepository};
    use crate::db::mock_stripe_event_log_repository::MockStripeEventLogRepository;
    use crate::db::oauth_token_repository::{NewUserOAuthToken, UserOAuthTokenRepository};
    use crate::db::workspace_connection_repository::{
        NewWorkspaceAuditEvent, NewWorkspaceConnection, WorkspaceConnectionRepository,
    };
    use crate::models::oauth_token::{ConnectedOAuthProvider, UserOAuthToken, WorkspaceConnection};
    use crate::services::oauth::workspace_service::{
        WorkspaceOAuthService, WorkspaceTokenRefresher,
    };
    use crate::services::smtp_mailer::MockMailer;
    use crate::state::AppState;
    use crate::utils::encryption::encrypt_secret;
    use crate::utils::jwt::JwtKeys;

    #[derive(Clone)]
    struct PersonalTokenRepo {
        token: Option<UserOAuthToken>,
    }

    impl PersonalTokenRepo {
        fn new(token: Option<UserOAuthToken>) -> Self {
            Self { token }
        }
    }

    #[async_trait]
    impl UserOAuthTokenRepository for PersonalTokenRepo {
        async fn upsert_token(
            &self,
            _new_token: NewUserOAuthToken,
        ) -> Result<UserOAuthToken, sqlx::Error> {
            Err(sqlx::Error::RowNotFound)
        }

        async fn find_by_id(&self, token_id: Uuid) -> Result<Option<UserOAuthToken>, sqlx::Error> {
            Ok(self.token.clone().filter(|token| token.id == token_id))
        }

        async fn find_by_user_and_provider(
            &self,
            user_id: Uuid,
            provider: ConnectedOAuthProvider,
        ) -> Result<Option<UserOAuthToken>, sqlx::Error> {
            if provider != ConnectedOAuthProvider::Slack {
                return Ok(None);
            }

            Ok(self
                .token
                .clone()
                .filter(|record| record.user_id == user_id))
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
            _user_id: Uuid,
        ) -> Result<Vec<UserOAuthToken>, sqlx::Error> {
            Ok(self
                .token
                .clone()
                .filter(|token| token.user_id == _user_id)
                .into_iter()
                .collect())
        }

        async fn mark_shared(
            &self,
            _user_id: Uuid,
            _provider: ConnectedOAuthProvider,
            _is_shared: bool,
        ) -> Result<UserOAuthToken, sqlx::Error> {
            Err(sqlx::Error::RowNotFound)
        }

        async fn list_by_user_and_provider(
            &self,
            user_id: Uuid,
            provider: ConnectedOAuthProvider,
        ) -> Result<Vec<UserOAuthToken>, sqlx::Error> {
            if provider != ConnectedOAuthProvider::Slack {
                return Ok(vec![]);
            }

            Ok(self
                .token
                .clone()
                .filter(|token| token.user_id == user_id)
                .into_iter()
                .collect())
        }
    }

    #[derive(Clone)]
    struct WorkspaceConnectionRepo {
        listing: WorkspaceConnection,
    }

    #[async_trait]
    impl WorkspaceConnectionRepository for WorkspaceConnectionRepo {
        async fn insert_connection(
            &self,
            _new_connection: NewWorkspaceConnection,
        ) -> Result<WorkspaceConnection, sqlx::Error> {
            Err(sqlx::Error::RowNotFound)
        }

        async fn find_by_id(
            &self,
            connection_id: Uuid,
        ) -> Result<Option<WorkspaceConnection>, sqlx::Error> {
            Ok((connection_id == self.listing.id).then_some(self.listing.clone()))
        }

        async fn get_by_id(&self, connection_id: Uuid) -> Result<WorkspaceConnection, sqlx::Error> {
            self.find_by_id(connection_id)
                .await?
                .ok_or(sqlx::Error::RowNotFound)
        }

        async fn list_for_workspace_provider(
            &self,
            _workspace_id: Uuid,
            _provider: ConnectedOAuthProvider,
        ) -> Result<Vec<WorkspaceConnection>, sqlx::Error> {
            Ok(Vec::new())
        }

        async fn find_by_source_token(
            &self,
            user_oauth_token_id: Uuid,
        ) -> Result<Vec<WorkspaceConnection>, sqlx::Error> {
            if self.listing.user_oauth_token_id == Some(user_oauth_token_id) {
                return Ok(vec![self.listing.clone()]);
            }
            Ok(Vec::new())
        }

        async fn list_by_workspace_and_provider(
            &self,
            _workspace_id: Uuid,
            _provider: ConnectedOAuthProvider,
        ) -> Result<Vec<WorkspaceConnection>, sqlx::Error> {
            Ok(Vec::new())
        }

        async fn list_for_workspace(
            &self,
            _workspace_id: Uuid,
        ) -> Result<
            Vec<crate::db::workspace_connection_repository::WorkspaceConnectionListing>,
            sqlx::Error,
        > {
            Ok(Vec::new())
        }

        async fn list_for_user_memberships(
            &self,
            _user_id: Uuid,
        ) -> Result<
            Vec<crate::db::workspace_connection_repository::WorkspaceConnectionListing>,
            sqlx::Error,
        > {
            use crate::db::workspace_connection_repository::WorkspaceConnectionListing;
            Ok(vec![WorkspaceConnectionListing {
                id: self.listing.id,
                connection_id: self.listing.connection_id,
                workspace_id: self.listing.workspace_id,
                owner_user_id: self.listing.owner_user_id,
                workspace_name: "Workspace".into(),
                provider: self.listing.provider,
                account_email: self.listing.account_email.clone(),
                expires_at: self.listing.expires_at,
                shared_by_first_name: None,
                shared_by_last_name: None,
                shared_by_email: None,
                updated_at: self.listing.updated_at,
                requires_reconnect: false,
                has_incoming_webhook: self.listing.incoming_webhook_url.is_some(),
            }])
        }

        async fn list_by_workspace_creator(
            &self,
            _workspace_id: Uuid,
            _creator_id: Uuid,
        ) -> Result<Vec<WorkspaceConnection>, sqlx::Error> {
            Ok(Vec::new())
        }

        async fn update_tokens_for_creator(
            &self,
            _creator_id: Uuid,
            _provider: ConnectedOAuthProvider,
            _access_token: String,
            _refresh_token: String,
            _expires_at: OffsetDateTime,
            _account_email: String,
            _bot_user_id: Option<String>,
            _slack_team_id: Option<String>,
            _incoming_webhook_url: Option<String>,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn update_tokens(
            &self,
            _connection_id: Uuid,
            _access_token: String,
            _refresh_token: String,
            _expires_at: OffsetDateTime,
            _bot_user_id: Option<String>,
            _slack_team_id: Option<String>,
            _incoming_webhook_url: Option<String>,
        ) -> Result<WorkspaceConnection, sqlx::Error> {
            Err(sqlx::Error::RowNotFound)
        }

        async fn update_tokens_for_connection(
            &self,
            _connection_id: Uuid,
            _access_token: String,
            _refresh_token: String,
            _expires_at: OffsetDateTime,
            _account_email: String,
            _bot_user_id: Option<String>,
            _slack_team_id: Option<String>,
            _incoming_webhook_url: Option<String>,
        ) -> Result<WorkspaceConnection, sqlx::Error> {
            Err(sqlx::Error::RowNotFound)
        }

        async fn delete_connection(&self, _connection_id: Uuid) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn delete_by_id(&self, _connection_id: Uuid) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn delete_by_owner_and_provider(
            &self,
            _workspace_id: Uuid,
            _owner_user_id: Uuid,
            _provider: ConnectedOAuthProvider,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn delete_by_owner_and_provider_and_id(
            &self,
            _workspace_id: Uuid,
            _owner_user_id: Uuid,
            _provider: ConnectedOAuthProvider,
            _connection_id: Uuid,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn has_connections_for_owner_provider(
            &self,
            _owner_user_id: Uuid,
            _provider: ConnectedOAuthProvider,
        ) -> Result<bool, sqlx::Error> {
            Ok(true)
        }

        async fn mark_connections_stale_for_creator(
            &self,
            _creator_id: Uuid,
            _provider: ConnectedOAuthProvider,
        ) -> Result<
            Vec<crate::db::workspace_connection_repository::StaleWorkspaceConnection>,
            sqlx::Error,
        > {
            Ok(Vec::new())
        }

        async fn record_audit_event(
            &self,
            _event: NewWorkspaceAuditEvent,
        ) -> Result<crate::models::oauth_token::WorkspaceAuditEvent, sqlx::Error> {
            Err(sqlx::Error::RowNotFound)
        }
    }

    fn stub_config() -> Arc<Config> {
        Arc::new(Config {
            database_url: "postgres://localhost".into(),
            frontend_origin: "http://localhost:5173".into(),
            admin_origin: "http://localhost:5173".into(),
            oauth: OAuthSettings {
                google: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "http://localhost/google".into(),
                },
                microsoft: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "http://localhost/microsoft".into(),
                },
                slack: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "http://localhost/slack".into(),
                },
                asana: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "http://localhost/asana".into(),
                },
                token_encryption_key: vec![0u8; 32],
            },
            api_secrets_encryption_key: vec![1u8; 32],
            stripe: StripeSettings {
                client_id: "stub".into(),
                secret_key: "stub".into(),
                webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            },
            auth_cookie_secure: true,
            webhook_secret: "0123456789abcdef0123456789ABCDEF".into(),
            jwt_issuer: "test-issuer".into(),
            jwt_audience: "test-audience".into(),
            workspace_member_limit: DEFAULT_WORKSPACE_MEMBER_LIMIT,
            workspace_monthly_run_limit: DEFAULT_WORKSPACE_MONTHLY_RUN_LIMIT,
            runaway_limit_5min: RUNAWAY_LIMIT_5MIN,
        })
    }

    fn test_jwt_keys() -> Arc<JwtKeys> {
        Arc::new(
            JwtKeys::from_secret("0123456789abcdef0123456789abcdef")
                .expect("test JWT secret should be valid"),
        )
    }

    fn test_claims(user_id: Uuid) -> Claims {
        Claims {
            id: user_id.to_string(),
            email: "user@example.com".into(),
            exp: 0,
            first_name: "Test".into(),
            last_name: "User".into(),
            role: None,
            plan: Some("workspace".into()),
            company_name: None,
            iss: "test".into(),
            aud: "test".into(),
            token_use: crate::routes::auth::claims::TokenUse::Access,
        }
    }

    fn base_state(
        config: Arc<Config>,
        workspace_repo: Arc<StaticWorkspaceMembershipRepository>,
        connection_repo: Arc<WorkspaceConnectionRepo>,
        personal_repo: Arc<PersonalTokenRepo>,
    ) -> AppState {
        let encryption_key = Arc::new(config.oauth.token_encryption_key.clone());
        let user_repo: Arc<dyn UserOAuthTokenRepository> = personal_repo.clone();
        let connection_repo: Arc<dyn WorkspaceConnectionRepository> = connection_repo;
        let workspace_repo_trait: Arc<dyn crate::db::workspace_repository::WorkspaceRepository> =
            workspace_repo.clone();
        let http_client = state_http_client();

        let oauth_accounts = Arc::new(
            crate::services::oauth::account_service::OAuthAccountService::new(
                user_repo.clone(),
                connection_repo.clone(),
                Arc::clone(&encryption_key),
                http_client.clone(),
                &config.oauth,
            ),
        );
        let workspace_token_refresher: Arc<dyn WorkspaceTokenRefresher> =
            oauth_accounts.clone() as Arc<dyn WorkspaceTokenRefresher>;
        let workspace_oauth = Arc::new(WorkspaceOAuthService::new(
            user_repo,
            workspace_repo_trait.clone(),
            connection_repo.clone(),
            workspace_token_refresher,
            encryption_key,
        ));

        AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo: Arc::new(NoopWorkflowRepository),
            workspace_repo: workspace_repo_trait,
            workspace_connection_repo: connection_repo,
            stripe_event_log_repo: Arc::new(MockStripeEventLogRepository::default()),
            db_pool: crate::state::test_pg_pool(),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(crate::services::oauth::google::client::GoogleOAuthClient {
                client: reqwest::Client::new(),
            }),
            github_oauth: Arc::new(crate::services::oauth::github::client::GitHubOAuthClient {
                client: reqwest::Client::new(),
            }),
            oauth_accounts,
            workspace_oauth,
            stripe: Arc::new(crate::services::stripe::MockStripeService::new()),
            http_client,
            config,
            worker_id: Arc::new("test-worker".into()),
            worker_lease_seconds: 30,
            jwt_keys: test_jwt_keys(),
        }
    }

    fn state_http_client() -> Arc<reqwest::Client> {
        Arc::new(reqwest::Client::new())
    }

    #[tokio::test]
    async fn lists_workspace_channels() {
        let server = MockServer::start_async().await;
        let base_url = format!("{}/api", server.base_url());

        let user_id = Uuid::new_v4();
        let workspace_id = Uuid::new_v4();
        let connection_id = Uuid::new_v4();
        let now = OffsetDateTime::now_utc();
        let config = stub_config();
        let encryption_key = Arc::new(config.oauth.token_encryption_key.clone());

        let encrypted_access = encrypt_secret(&encryption_key, "workspace-access").unwrap();
        let encrypted_refresh = encrypt_secret(&encryption_key, "workspace-refresh").unwrap();

        server
            .mock_async(|when, then| {
                when.method(httpmock::Method::GET)
                    .path("/api/conversations.list")
                    .header("authorization", "Bearer workspace-access");
                then.status(200)
                    .header("content-type", "application/json")
                    .body(
                        r#"{
                    "ok": true,
                    "channels": [
                      { "id": "C1", "name": "general", "is_private": false },
                      { "id": "C2", "name": "alerts", "is_private": true }
                    ]
                }"#,
                    );
            })
            .await;

        let workspace_repo = Arc::new(StaticWorkspaceMembershipRepository::with_plan(
            crate::models::plan::PlanTier::Workspace,
        ));

        let listing = WorkspaceConnection {
            id: connection_id,
            connection_id: Some(connection_id),
            workspace_id,
            created_by: user_id,
            owner_user_id: user_id,
            user_oauth_token_id: Some(Uuid::new_v4()),
            provider: ConnectedOAuthProvider::Slack,
            access_token: encrypted_access.clone(),
            refresh_token: encrypted_refresh.clone(),
            expires_at: now + Duration::hours(1),
            account_email: "owner@example.com".into(),
            created_at: now,
            updated_at: now,
            metadata: serde_json::Value::Null,
            slack_team_id: None,
            bot_user_id: None,
            incoming_webhook_url: None,
        };
        let connection_repo = Arc::new(WorkspaceConnectionRepo {
            listing: listing.clone(),
        });

        let personal_repo = Arc::new(PersonalTokenRepo::new(Some(UserOAuthToken {
            id: Uuid::new_v4(),
            user_id,
            workspace_id: None,
            provider: ConnectedOAuthProvider::Slack,
            access_token: encrypted_access.clone(),
            refresh_token: encrypted_refresh,
            expires_at: now + Duration::hours(1),
            account_email: "owner@example.com".into(),
            metadata: serde_json::json!({}),
            is_shared: false,
            created_at: now,
            updated_at: now,
        })));

        let state = base_state(config, workspace_repo, connection_repo, personal_repo);
        let response = list_channels(
            State(state),
            AuthSession(test_claims(user_id)),
            Query(ConnectionQuery {
                scope: Some("workspace".into()),
                connection_id: Some(connection_id),
                base_url: Some(base_url),
            }),
        )
        .await;

        assert_eq!(response.status(), AxumStatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let parsed: SlackChannelsResponse =
            serde_json::from_slice(&body).expect("valid slack response");

        assert!(parsed.success);
        assert_eq!(parsed.channels.len(), 2);
        assert_eq!(parsed.channels[0].id, "C2"); // sorted by name
        assert_eq!(parsed.channels[1].id, "C1");
    }
}
