use std::net::SocketAddr;

use axum::{
    extract::{ConnectInfo, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use axum_extra::{headers::UserAgent, typed_header::TypedHeader};
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::{
    models::account_deletion::AccountDeletionAuditInsert,
    responses::JsonResponse,
    routes::auth::session::AuthSession,
    state::AppState,
    utils::{
        password::verify_password,
        secrets::{collect_secret_identifiers, read_secret_store},
    },
};

const ACCOUNT_DELETION_TOKEN_HOURS: i64 = 24;
const ACCOUNT_DELETION_COMPLIANCE_NOTICE: &str =
    "DSentr retains a non-public audit of this deletion for regulatory compliance.";

const ADDITIONAL_DATA_POINTS: &[&str] = &[
    "Workflow run history, execution logs, and queued jobs",
    "Stored API keys, secrets, and workspace credential caches",
    "User OAuth tokens and any workspace-level integrations",
    "Pending workspace invitations and member audit entries",
    "Webhook replay buffers and workflow scheduling metadata",
];

const SYSTEM_IMPACT_POINTS: &[&str] = &[
    "Team members will immediately lose access to workflows owned by this account",
    "Scheduled and running automations will halt because the underlying workflows are deleted",
    "Shared workspace credentials and integrations tied to this owner will be revoked",
    "Any pending Stripe subscriptions linked to this user will be cancelled",
];

#[derive(Debug, Deserialize)]
pub struct AccountDeletionRequestPayload {
    pub email: String,
    pub password: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AccountDeletionConfirmPayload {
    pub token: String,
    pub email: String,
    pub password: Option<String>,
}

#[derive(Debug, Serialize)]
struct AccountDeletionCountsPayload {
    workflows: i64,
    owned_workspaces: i64,
    member_workspaces: i64,
    workflow_runs: i64,
    workflow_logs: i64,
    oauth_connections: i64,
    pending_invitations: i64,
    secrets: usize,
}

#[derive(Debug, Serialize)]
struct AccountDeletionStripeSummary {
    has_customer: bool,
    has_active_subscription: bool,
}

#[derive(Debug, Serialize)]
struct AccountDeletionSummaryResponse {
    success: bool,
    email: String,
    requested_at: String,
    expires_at: String,
    requires_password: bool,
    oauth_provider: Option<String>,
    counts: AccountDeletionCountsPayload,
    stripe: AccountDeletionStripeSummary,
    additional_data: Vec<String>,
    system_impacts: Vec<String>,
    compliance_notice: &'static str,
}

pub async fn request_account_deletion(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Json(payload): Json<AccountDeletionRequestPayload>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    let email = payload.email.trim();
    if email.is_empty() {
        return JsonResponse::bad_request("Email is required").into_response();
    }

    let user = match state.db.find_user_by_email(email).await {
        Ok(Some(user)) => user,
        Ok(None) => return JsonResponse::unauthorized("Invalid credentials").into_response(),
        Err(err) => {
            error!(?err, "failed to load user during account deletion request");
            return JsonResponse::server_error("Failed to load account").into_response();
        }
    };

    if user.id != user_id {
        return JsonResponse::unauthorized("Invalid credentials").into_response();
    }

    let requires_password = !user.password_hash.trim().is_empty();

    if requires_password {
        let Some(password) = payload.password.as_ref().map(|p| p.trim()) else {
            return JsonResponse::bad_request("Password is required to confirm deletion")
                .into_response();
        };

        match verify_password(password, &user.password_hash) {
            Ok(true) => {}
            Ok(false) => {
                return JsonResponse::unauthorized("Invalid credentials").into_response();
            }
            Err(err) => {
                error!(
                    ?err,
                    "password verification failed during account deletion request"
                );
                return JsonResponse::server_error("Failed to verify credentials").into_response();
            }
        }
    }

    let token = Uuid::new_v4().to_string();
    let expires_at = OffsetDateTime::now_utc() + Duration::hours(ACCOUNT_DELETION_TOKEN_HOURS);

    if let Err(err) = state
        .db
        .upsert_account_deletion_token(user.id, &token, expires_at)
        .await
    {
        error!(?err, %user_id, "failed to persist account deletion token");
        return JsonResponse::server_error("Failed to start account deletion").into_response();
    }

    let counts = match state.db.collect_account_deletion_counts(user.id).await {
        Ok(counts) => counts,
        Err(err) => {
            error!(?err, %user_id, "failed to gather deletion counts");
            return JsonResponse::server_error("Failed to prepare account deletion")
                .into_response();
        }
    };

    let secret_count = match state.db.get_user_settings(user.id).await {
        Ok(settings) => count_user_secrets(&settings),
        Err(err) => {
            error!(?err, %user_id, "failed to load user settings for deletion summary");
            return JsonResponse::server_error("Failed to prepare account deletion")
                .into_response();
        }
    };

    let frontend_origin = state.config.frontend_origin.trim_end_matches('/');
    let confirmation_link = format!("{}/delete-account/{}", frontend_origin, token);
    let expires_at_str = format_timestamp(expires_at);

    let additional_data = additional_data_items();
    let system_impacts = system_impact_items();

    let email_body = format!(
        r#"You requested to permanently delete your DSentr account.

This action will remove:
- {workflow_count} workflow(s) you own
- {owned_workspaces} owned workspace(s) and their memberships
- {member_workspaces} workspace membership(s) where you are a collaborator
- {secret_count} saved secret(s) and API credentials
- Pending invitations, OAuth connections, logs, and workflow run history

Additional associated data includes:
{additional}

System-wide impacts:
{impacts}

To continue, confirm the deletion within {expires_at}.
Confirmation link: {confirmation_link}

If you did not initiate this request, you can ignore this email and your account will remain active.

{compliance_notice}
"#,
        workflow_count = counts.workflow_count,
        owned_workspaces = counts.owned_workspace_count,
        member_workspaces = counts.member_workspace_count,
        secret_count = secret_count,
        additional = format_bullet_list(&additional_data),
        impacts = format_bullet_list(&system_impacts),
        expires_at = expires_at_str,
        confirmation_link = confirmation_link,
        compliance_notice = ACCOUNT_DELETION_COMPLIANCE_NOTICE,
    );

    if let Err(err) = state
        .mailer
        .send_email_generic(
            &user.email,
            "Confirm your DSentr account deletion",
            &email_body,
        )
        .await
    {
        error!(?err, %user_id, "failed to send account deletion confirmation email");
        return JsonResponse::server_error("Failed to send confirmation email").into_response();
    }

    info!(%user_id, "account deletion confirmation email dispatched");

    JsonResponse::success(
        "Check your email for a confirmation link to permanently delete your account.",
    )
    .into_response()
}

pub async fn get_account_deletion_summary(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Response {
    if token.trim().is_empty() {
        return JsonResponse::bad_request("Deletion token is required").into_response();
    }

    let context = match state.db.get_account_deletion_context(&token).await {
        Ok(Some(ctx)) => ctx,
        Ok(None) => return JsonResponse::not_found("Deletion link is invalid").into_response(),
        Err(err) => {
            error!(?err, "failed to load account deletion context");
            return JsonResponse::server_error("Failed to load deletion details").into_response();
        }
    };

    let now = OffsetDateTime::now_utc();
    if context.token.expires_at <= now {
        return JsonResponse::bad_request("This deletion link has expired. Please start again.")
            .into_response();
    }

    if context.token.consumed_at.is_some() {
        return JsonResponse::bad_request("This deletion link has already been used.")
            .into_response();
    }

    let counts = match state
        .db
        .collect_account_deletion_counts(context.user.id)
        .await
    {
        Ok(counts) => counts,
        Err(err) => {
            error!(%context.user.id, ?err, "failed to gather deletion counts for summary");
            return JsonResponse::server_error("Failed to load deletion details").into_response();
        }
    };

    let secret_count = match state.db.get_user_settings(context.user.id).await {
        Ok(settings) => count_user_secrets(&settings),
        Err(err) => {
            error!(%context.user.id, ?err, "failed to load secrets for deletion summary");
            return JsonResponse::server_error("Failed to load deletion details").into_response();
        }
    };

    let requires_password = !context.user.password_hash.trim().is_empty();
    let oauth_provider = context
        .user
        .oauth_provider
        .map(|provider| provider.to_string());

    let has_customer = context.user.stripe_customer_id.is_some();
    let mut has_active_subscription = false;
    if let Some(customer_id) = context.user.stripe_customer_id.as_ref() {
        match state
            .stripe
            .get_active_subscription_for_customer(customer_id)
            .await
        {
            Ok(Some(sub)) => {
                has_active_subscription = true;
                if let (Ok(period_start), Ok(period_end)) = (
                    OffsetDateTime::from_unix_timestamp(sub.current_period_start),
                    OffsetDateTime::from_unix_timestamp(sub.current_period_end),
                ) {
                    state
                        .sync_owned_workspace_billing_cycles(
                            context.user.id,
                            &sub.id,
                            period_start,
                            period_end,
                        )
                        .await;
                }
            }
            Ok(None) => {}
            Err(err) => {
                warn!(?err, %customer_id, "failed to check Stripe subscription during summary");
            }
        }
    }

    let response = AccountDeletionSummaryResponse {
        success: true,
        email: context.user.email.clone(),
        requested_at: format_timestamp(context.token.created_at),
        expires_at: format_timestamp(context.token.expires_at),
        requires_password,
        oauth_provider,
        counts: AccountDeletionCountsPayload {
            workflows: counts.workflow_count,
            owned_workspaces: counts.owned_workspace_count,
            member_workspaces: counts.member_workspace_count,
            workflow_runs: counts.workflow_run_count,
            workflow_logs: counts.workflow_log_count,
            oauth_connections: counts.oauth_connection_count,
            pending_invitations: counts.workspace_invitation_count,
            secrets: secret_count,
        },
        stripe: AccountDeletionStripeSummary {
            has_customer,
            has_active_subscription,
        },
        additional_data: additional_data_items(),
        system_impacts: system_impact_items(),
        compliance_notice: ACCOUNT_DELETION_COMPLIANCE_NOTICE,
    };

    (StatusCode::OK, Json(json!(response))).into_response()
}

pub async fn confirm_account_deletion(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    maybe_agent: Option<TypedHeader<UserAgent>>,
    Json(payload): Json<AccountDeletionConfirmPayload>,
) -> Response {
    if payload.token.trim().is_empty() {
        return JsonResponse::bad_request("Deletion token is required").into_response();
    }

    let email = payload.email.trim();
    if email.is_empty() {
        return JsonResponse::bad_request("Email is required").into_response();
    }

    let context = match state.db.get_account_deletion_context(&payload.token).await {
        Ok(Some(ctx)) => ctx,
        Ok(None) => return JsonResponse::not_found("Deletion link is invalid").into_response(),
        Err(err) => {
            error!(?err, "failed to load account deletion context");
            return JsonResponse::server_error("Failed to confirm account deletion")
                .into_response();
        }
    };

    let now = OffsetDateTime::now_utc();
    if context.token.expires_at <= now {
        return JsonResponse::bad_request("This deletion link has expired. Start again.")
            .into_response();
    }

    if context.token.consumed_at.is_some() {
        return JsonResponse::bad_request("This deletion link has already been used.")
            .into_response();
    }

    if !context.user.email.eq_ignore_ascii_case(email) {
        return JsonResponse::unauthorized("Email does not match this deletion request")
            .into_response();
    }

    let requires_password = !context.user.password_hash.trim().is_empty();
    if requires_password {
        let Some(password) = payload.password.as_ref().map(|p| p.trim()) else {
            return JsonResponse::bad_request("Password is required to confirm deletion")
                .into_response();
        };

        match verify_password(password, &context.user.password_hash) {
            Ok(true) => {}
            Ok(false) => {
                return JsonResponse::unauthorized("Invalid credentials").into_response();
            }
            Err(err) => {
                error!(?err, %context.user.id, "password verification failed during deletion confirm");
                return JsonResponse::server_error("Failed to verify credentials").into_response();
            }
        }
    }

    let counts = match state
        .db
        .collect_account_deletion_counts(context.user.id)
        .await
    {
        Ok(counts) => counts,
        Err(err) => {
            error!(%context.user.id, ?err, "failed to gather deletion counts during confirmation");
            return JsonResponse::server_error("Failed to confirm account deletion")
                .into_response();
        }
    };

    let secret_count = match state.db.get_user_settings(context.user.id).await {
        Ok(settings) => count_user_secrets(&settings),
        Err(err) => {
            error!(%context.user.id, ?err, "failed to load secrets during deletion confirm");
            return JsonResponse::server_error("Failed to confirm account deletion")
                .into_response();
        }
    };

    let mut stripe_cancelled = false;
    if let Some(customer_id) = context.user.stripe_customer_id.as_ref() {
        match state
            .stripe
            .get_active_subscription_for_customer(customer_id)
            .await
        {
            Ok(Some(subscription)) => {
                match state
                    .stripe
                    .cancel_subscription_immediately(&subscription.id)
                    .await
                {
                    Ok(()) => {
                        stripe_cancelled = true;
                        state
                            .clear_owned_workspace_billing_cycles(context.user.id)
                            .await;
                    }
                    Err(err) => {
                        error!(?err, %customer_id, "failed to cancel Stripe subscription during account deletion");
                    }
                }
            }
            Ok(None) => {}
            Err(err) => {
                warn!(?err, %customer_id, "failed to check Stripe subscription during confirmation");
            }
        }
    }

    let metadata = json!({
        "secret_count": secret_count,
        "workflow_run_count": counts.workflow_run_count,
        "workflow_log_count": counts.workflow_log_count,
        "oauth_connection_count": counts.oauth_connection_count,
        "pending_invitation_count": counts.workspace_invitation_count,
        "additional_data_removed": additional_data_items(),
        "system_impacts": system_impact_items(),
        "stripe_subscription_cancelled": stripe_cancelled,
    });

    let ip_address = Some(addr.ip().to_string());
    let user_agent = maybe_agent
        .map(|TypedHeader(agent)| agent.to_string())
        .filter(|s| !s.is_empty());

    let audit = AccountDeletionAuditInsert {
        user_id: context.user.id,
        email: context.user.email.clone(),
        requested_at: context.token.created_at,
        confirmed_at: now,
        workflow_count: counts.workflow_count,
        owned_workspace_count: counts.owned_workspace_count,
        member_workspace_count: counts.member_workspace_count,
        stripe_customer_id: context.user.stripe_customer_id.clone(),
        oauth_provider: context
            .user
            .oauth_provider
            .map(|provider| provider.to_string()),
        ip_address,
        user_agent,
        metadata,
    };

    if let Err(err) = state
        .db
        .finalize_account_deletion(&payload.token, audit)
        .await
    {
        error!(?err, %context.user.id, "failed to finalize account deletion");
        return JsonResponse::server_error("Failed to confirm account deletion").into_response();
    }

    let confirmation_email_body = format!(
        "We have started deleting your DSentr account and associated data. Stripe subscriptions have been cancelled when applicable.\n\n{}",
        ACCOUNT_DELETION_COMPLIANCE_NOTICE,
    );

    if let Err(err) = state
        .mailer
        .send_email_generic(
            &context.user.email,
            "Your DSentr account deletion has been confirmed",
            &confirmation_email_body,
        )
        .await
    {
        warn!(?err, %context.user.id, "failed to send post-deletion confirmation email");
    }

    info!(%context.user.id, "account deletion confirmed and scheduled");

    JsonResponse::success(
        "Your account deletion has been confirmed. Data removal and billing cancellation are now underway.",
    )
    .into_response()
}

fn count_user_secrets(settings: &serde_json::Value) -> usize {
    let store = read_secret_store(settings);
    collect_secret_identifiers(&store).len()
}

fn format_timestamp(timestamp: OffsetDateTime) -> String {
    timestamp
        .format(&Rfc3339)
        .unwrap_or_else(|_| timestamp.to_string())
}

fn additional_data_items() -> Vec<String> {
    ADDITIONAL_DATA_POINTS
        .iter()
        .map(|s| s.to_string())
        .collect()
}

fn system_impact_items() -> Vec<String> {
    SYSTEM_IMPACT_POINTS.iter().map(|s| s.to_string()).collect()
}

fn format_bullet_list(items: &[String]) -> String {
    items
        .iter()
        .map(|item| format!("- {}", item))
        .collect::<Vec<_>>()
        .join("\n")
}

// --- Privacy preference (share workflows for improvement) ---

#[derive(serde::Deserialize)]
pub struct UpdatePrivacyPayload {
    pub allow: bool,
}

#[derive(serde::Serialize)]
pub struct PrivacyResponse {
    pub success: bool,
    pub allow: bool,
}

pub async fn get_privacy_preference(
    axum::extract::State(state): axum::extract::State<crate::state::AppState>,
    crate::routes::auth::session::AuthSession(claims): crate::routes::auth::session::AuthSession,
) -> axum::response::Response {
    let user_id = match uuid::Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => {
            return crate::responses::JsonResponse::unauthorized("Invalid user ID").into_response()
        }
    };

    let Ok(settings) = state.db.get_user_settings(user_id).await else {
        // Default to true if settings are unavailable
        return (
            axum::http::StatusCode::OK,
            axum::Json(PrivacyResponse {
                success: true,
                allow: true,
            }),
        )
            .into_response();
    };

    let allow = settings
        .get("privacy")
        .and_then(|p| p.get("share_workflows_for_improvement"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    (
        axum::http::StatusCode::OK,
        axum::Json(PrivacyResponse {
            success: true,
            allow,
        }),
    )
        .into_response()
}

pub async fn update_privacy_preference(
    axum::extract::State(state): axum::extract::State<crate::state::AppState>,
    crate::routes::auth::session::AuthSession(claims): crate::routes::auth::session::AuthSession,
    axum::extract::Json(payload): axum::extract::Json<UpdatePrivacyPayload>,
) -> axum::response::Response {
    let user_id = match uuid::Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => {
            return crate::responses::JsonResponse::unauthorized("Invalid user ID").into_response()
        }
    };

    let Ok(mut settings) = state.db.get_user_settings(user_id).await else {
        return crate::responses::JsonResponse::server_error("Failed to load settings")
            .into_response();
    };

    // Ensure nested object exists and set value
    let root = if let Some(obj) = settings.as_object_mut() {
        obj
    } else {
        settings = serde_json::Value::Object(serde_json::Map::new());
        settings.as_object_mut().unwrap()
    };

    let privacy = root
        .entry("privacy")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .unwrap();
    privacy.insert(
        "share_workflows_for_improvement".to_string(),
        serde_json::Value::Bool(payload.allow),
    );

    if let Err(err) = state.db.update_user_settings(user_id, settings).await {
        tracing::error!(?err, %user_id, "failed to update privacy preference");
        return crate::responses::JsonResponse::server_error("Failed to update preference")
            .into_response();
    }

    (
        axum::http::StatusCode::OK,
        axum::Json(PrivacyResponse {
            success: true,
            allow: payload.allow,
        }),
    )
        .into_response()
}
