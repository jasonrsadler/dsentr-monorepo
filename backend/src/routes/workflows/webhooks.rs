use super::{prelude::*, runs::redact_run};
use crate::config::MIN_WEBHOOK_SECRET_LENGTH;
use crate::{
    routes::plan_limits::workspace_limit_error_response,
    runaway_protection::{
        enforce_runaway_protection, RunawayProtectionError, RUNAWAY_PROTECTION_ERROR,
    },
    state::WorkspaceRunQuotaTicket,
    utils::plan_limits::NormalizedPlanTier,
};
use axum::http::HeaderMap;
use tracing::error;
use urlencoding::encode;

type HmacSha256 = Hmac<Sha256>;

fn compute_webhook_token(secret: &str, user_id: Uuid, workflow_id: Uuid, salt: Uuid) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(user_id.as_bytes());
    mac.update(workflow_id.as_bytes());
    mac.update(salt.as_bytes());
    let res = mac.finalize().into_bytes();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(res)
}

fn compute_webhook_signing_key(
    secret: &str,
    user_id: Uuid,
    workflow_id: Uuid,
    salt: Uuid,
) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(user_id.as_bytes());
    mac.update(workflow_id.as_bytes());
    mac.update(salt.as_bytes());
    mac.update(b"signing");
    let res = mac.finalize().into_bytes();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(res)
}

fn webhook_secret(config: &crate::config::Config) -> Option<String> {
    let secret = config.webhook_secret.clone();
    if secret.len() < MIN_WEBHOOK_SECRET_LENGTH {
        error!("WEBHOOK_SECRET is not configured with sufficient entropy");
        return None;
    }
    Some(secret)
}

fn missing_webhook_secret_response() -> Response {
    JsonResponse::server_error("Webhook secret is not configured; contact an administrator.")
        .into_response()
}

#[derive(Debug, Clone)]
struct WebhookTrigger {
    id: String,
    label: String,
    normalized_label: String,
}

fn collect_webhook_triggers(snapshot: &serde_json::Value) -> Vec<WebhookTrigger> {
    snapshot
        .get("nodes")
        .and_then(|arr| arr.as_array())
        .map(|nodes| {
            nodes
                .iter()
                .filter_map(|node| {
                    let node_type = node.get("type")?.as_str()?;
                    if node_type != "trigger" {
                        return None;
                    }
                    let data = node.get("data")?;
                    let trigger_type = data
                        .get("triggerType")
                        .and_then(|t| t.as_str())
                        .unwrap_or_default();
                    if !trigger_type.eq_ignore_ascii_case("webhook") {
                        return None;
                    }
                    let id = node.get("id")?.as_str()?.to_string();
                    let raw_label = data
                        .get("label")
                        .and_then(|v| v.as_str())
                        .map(|s| s.trim())
                        .unwrap_or_default();
                    let label = if raw_label.is_empty() {
                        id.clone()
                    } else {
                        raw_label.to_string()
                    };
                    let normalized_label = label.to_lowercase();
                    Some(WebhookTrigger {
                        id,
                        label,
                        normalized_label,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn select_target_trigger<'a>(
    triggers: &'a [WebhookTrigger],
    requested_label: Option<&str>,
) -> Option<&'a WebhookTrigger> {
    if let Some(label) = requested_label.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_lowercase())
        }
    }) {
        triggers
            .iter()
            .find(|trigger| trigger.normalized_label == label)
    } else if triggers.len() == 1 {
        triggers.first()
    } else {
        None
    }
}

fn build_trigger_urls(base_url: &str, triggers: &[WebhookTrigger]) -> Vec<serde_json::Value> {
    triggers
        .iter()
        .map(|trigger| {
            let encoded_label = encode(&trigger.label);
            json!({
                "label": trigger.label,
                "url": format!("{}/{}", base_url, encoded_label)
            })
        })
        .collect()
}

fn webhook_url_payload(base_url: String, triggers: &[WebhookTrigger]) -> serde_json::Value {
    let trigger_urls = build_trigger_urls(&base_url, triggers);
    json!({
        "success": true,
        "url": base_url,
        "triggers": trigger_urls
    })
}

pub async fn get_webhook_url(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    match app_state
        .workflow_repo
        .find_workflow_for_member(user_id, workflow_id)
        .await
    {
        Ok(Some(wf)) => {
            let secret = match webhook_secret(app_state.config.as_ref()) {
                Some(secret) => secret,
                None => return missing_webhook_secret_response(),
            };
            let token = compute_webhook_token(&secret, wf.user_id, wf.id, wf.webhook_salt);
            let url = format!("/api/workflows/{}/trigger/{}", wf.id, token);
            let triggers = collect_webhook_triggers(&wf.data);
            (StatusCode::OK, Json(webhook_url_payload(url, &triggers))).into_response()
        }
        Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error: {:?}", e);
            JsonResponse::server_error("Failed to get webhook URL").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct WebhookPathParams {
    pub workflow_id: Uuid,
    pub token: String,
    pub trigger_label: Option<String>,
}

pub async fn webhook_trigger(
    State(app_state): State<AppState>,
    Path(params): Path<WebhookPathParams>,
    headers: HeaderMap,
    body: Option<Json<serde_json::Value>>,
) -> Response {
    let WebhookPathParams {
        workflow_id,
        token,
        trigger_label,
    } = params;

    let wf = match app_state
        .workflow_repo
        .find_workflow_by_id_public(workflow_id)
        .await
    {
        Ok(Some(w)) => w,
        Ok(None) => return JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error: {:?}", e);
            return JsonResponse::server_error("Failed to enqueue").into_response();
        }
    };

    let webhook_triggers = collect_webhook_triggers(&wf.data);
    let selected_trigger = select_target_trigger(&webhook_triggers, trigger_label.as_deref());

    if webhook_triggers.is_empty() || selected_trigger.is_none() {
        // As if this workflow never existed.
        return JsonResponse::not_found("Workflow not found").into_response();
    }

    let secret = match webhook_secret(app_state.config.as_ref()) {
        Some(secret) => secret,
        None => return missing_webhook_secret_response(),
    };
    let expected = compute_webhook_token(&secret, wf.user_id, wf.id, wf.webhook_salt);
    if token != expected {
        return JsonResponse::unauthorized("Invalid token").into_response();
    }

    let workspace_id = match wf.workspace_id {
        Some(id) => id,
        None => return JsonResponse::not_found("Workflow not in a workspace").into_response(),
    };

    let workspace = match app_state.workspace_repo.find_workspace(workspace_id).await {
        Ok(Some(ws)) => ws,
        _ => return JsonResponse::not_found("Workspace not found").into_response(),
    };

    // Runtime premium gating. Stop everything before touching HMAC logic.
    if workspace.plan == "solo" && wf.require_hmac {
        return JsonResponse::forbidden("Webhook signing requires the Workspace plan.")
            .into_response();
    }

    if wf.require_hmac {
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let signing_key_b64 =
            compute_webhook_signing_key(&secret, wf.user_id, wf.id, wf.webhook_salt);

        // Prefer explicit overrides (testing), then headers, then legacy JSON fields.
        let (ts_str, sig_str, used_headers) = {
            if let (Ok(ts), Ok(sg)) = (
                std::env::var("X_DSENTR_TS_OVERRIDE"),
                std::env::var("X_DSENTR_SIG_OVERRIDE"),
            ) {
                (ts, sg, true)
            } else {
                let ts_h = headers
                    .get("X-DSentr-Timestamp")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                let sg_h = headers
                    .get("X-DSentr-Signature")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                if let (Some(ts), Some(sg)) = (ts_h, sg_h) {
                    (ts, sg, true)
                } else if let Some(Json(ref b)) = body {
                    let ts_v = b
                        .get("_dsentr_ts")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let sg_v = b
                        .get("_dsentr_sig")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    (ts_v, sg_v, false)
                } else {
                    (String::new(), String::new(), false)
                }
            }
        };

        if ts_str.is_empty() || sig_str.is_empty() {
            return JsonResponse::unauthorized("Missing HMAC signature").into_response();
        }
        let ts = ts_str.parse::<i64>().unwrap_or(0);
        if ts <= 0 || (now - ts).abs() as i32 > wf.hmac_replay_window_sec {
            return JsonResponse::unauthorized("Stale or invalid timestamp").into_response();
        }

        // For header-based auth, sign the canonical JSON body as sent by client.
        // For legacy body fields, exclude _dsentr_ts/_dsentr_sig keys from the
        // signed payload to make the signature computable by clients.
        let raw_body = if let Some(Json(ref v)) = body {
            if used_headers {
                v.to_string()
            } else {
                let mut cloned = v.clone();
                if let Some(obj) = cloned.as_object_mut() {
                    obj.remove("_dsentr_sig");
                    obj.remove("_dsentr_ts");
                }
                cloned.to_string()
            }
        } else {
            String::new()
        };
        let payload = format!("{}.{}", ts_str, raw_body);
        let key_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(signing_key_b64.as_bytes())
            .unwrap_or_default();
        let mut mac = HmacSha256::new_from_slice(&key_bytes).expect("HMAC");
        mac.update(payload.as_bytes());
        let expected = hex::encode(mac.finalize().into_bytes());
        let provided = sig_str.strip_prefix("v1=").unwrap_or(sig_str.as_str());
        if subtle::ConstantTimeEq::ct_eq(expected.as_bytes(), provided.as_bytes()).unwrap_u8()
            == 0u8
        {
            return JsonResponse::unauthorized("Invalid HMAC signature").into_response();
        }
        if let Ok(false) = app_state
            .workflow_repo
            .try_record_webhook_signature(wf.id, provided)
            .await
        {
            return JsonResponse::unauthorized("Replay detected").into_response();
        }
    }

    let settings = match app_state.db.get_user_settings(wf.user_id).await {
        Ok(val) => val,
        Err(err) => {
            error!(?err, user_id = %wf.user_id, "failed to load user settings");
            return JsonResponse::server_error("Failed to enqueue").into_response();
        }
    };

    if let Some(workspace_id) = wf.workspace_id {
        if let Err(err) = enforce_runaway_protection(&app_state, workspace_id, &settings).await {
            match err {
                RunawayProtectionError::RunawayProtectionTriggered { .. } => {
                    return (
                        StatusCode::TOO_MANY_REQUESTS,
                        Json(json!({ "error": RUNAWAY_PROTECTION_ERROR })),
                    )
                        .into_response();
                }
                RunawayProtectionError::Database(db_err) => {
                    error!(
                        ?db_err,
                        %workspace_id,
                        "failed to enforce runaway protection"
                    );
                    return JsonResponse::server_error("Failed to enqueue").into_response();
                }
            }
        }
    }

    let mut snapshot = wf.data.clone();
    if let Some(Json(ctx)) = body {
        snapshot["_trigger_context"] = ctx;
    }
    if let Some(target) = selected_trigger {
        snapshot["_start_from_node"] = serde_json::Value::String(target.id.clone());
        snapshot["_start_trigger_label"] = serde_json::Value::String(target.label.clone());
    }
    snapshot["_egress_allowlist"] = serde_json::Value::Array(
        wf.egress_allowlist
            .iter()
            .cloned()
            .map(serde_json::Value::String)
            .collect(),
    );

    let mut workspace_quota: Option<WorkspaceRunQuotaTicket> = None;
    if let Some(workspace_id) = wf.workspace_id {
        match app_state.consume_workspace_run_quota(workspace_id).await {
            Ok(Some(ticket)) => {
                if ticket.run_count > ticket.limit {
                    tracing::warn!(
                        %workspace_id,
                        run_count = ticket.run_count,
                        overage_count = ticket.overage_count,
                        "workspace run usage exceeded limit; recording overage"
                    );
                }
                workspace_quota = Some(ticket);
            }
            Ok(None) => {}
            Err(err) => return workspace_limit_error_response(err),
        }
    }

    match app_state
        .workflow_repo
        .create_workflow_run(wf.user_id, wf.id, wf.workspace_id, snapshot, None)
        .await
    {
        Ok(outcome) => {
            if let (Some(ticket), false) = (&workspace_quota, outcome.created) {
                let _ = app_state.release_workspace_run_quota(*ticket).await;
            }
            let safe_run = redact_run(outcome.run);
            (
                StatusCode::ACCEPTED,
                Json(json!({"success": true, "run": safe_run})),
            )
                .into_response()
        }
        Err(e) => {
            if let Some(ticket) = workspace_quota {
                let _ = app_state.release_workspace_run_quota(ticket).await;
            }
            eprintln!("DB error creating run: {:?}", e);
            JsonResponse::server_error("Failed to enqueue run").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct WebhookConfigBody {
    pub require_hmac: bool,
    pub replay_window_sec: i32,
}

pub async fn get_webhook_config(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    match app_state
        .workflow_repo
        .find_workflow_for_member(user_id, workflow_id)
        .await
    {
        Ok(Some(wf)) => {
            let secret = match webhook_secret(app_state.config.as_ref()) {
                Some(secret) => secret,
                None => return missing_webhook_secret_response(),
            };
            let signing_key =
                compute_webhook_signing_key(&secret, wf.user_id, wf.id, wf.webhook_salt);
            (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "require_hmac": wf.require_hmac,
                    "replay_window_sec": wf.hmac_replay_window_sec,
                    "signing_key": signing_key
                })),
            )
                .into_response()
        }
        Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(_) => JsonResponse::server_error("Failed").into_response(),
    }
}

pub async fn set_webhook_config(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
    Json(body): Json<WebhookConfigBody>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    let replay = body.replay_window_sec.clamp(60, 3600);

    // Enforce plan gating: HMAC is only available on workspace plans
    match app_state
        .workflow_repo
        .find_workflow_for_member(user_id, workflow_id)
        .await
    {
        Ok(Some(wf)) => {
            // Determine effective plan tier: personal (no workspace) is Solo
            let is_solo_plan = match wf.workspace_id {
                None => true,
                Some(ws_id) => match app_state.workspace_repo.find_workspace(ws_id).await {
                    Ok(Some(ws)) => {
                        NormalizedPlanTier::from_option(Some(ws.plan.as_str())).is_solo()
                    }
                    // If the workspace cannot be loaded, fail closed (treat as solo)
                    Ok(None) => true,
                    Err(_) => true,
                },
            };

            if is_solo_plan && body.require_hmac {
                return JsonResponse::forbidden(
                    "HMAC verification is available on workspace plans. Upgrade your plan to enable it.",
                )
                .into_response();
            }
        }
        Ok(None) => return JsonResponse::not_found("Workflow not found").into_response(),
        Err(_) => return JsonResponse::server_error("Failed to update").into_response(),
    }
    match app_state
        .workflow_repo
        .update_webhook_config(user_id, workflow_id, body.require_hmac, replay)
        .await
    {
        Ok(true) => (StatusCode::OK, Json(json!({"success": true }))).into_response(),
        Ok(false) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(_) => JsonResponse::server_error("Failed to update").into_response(),
    }
}

pub async fn regenerate_webhook_token(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };
    match app_state
        .workflow_repo
        .rotate_webhook_salt(user_id, workflow_id)
        .await
    {
        Ok(Some(new_salt)) => {
            let wf = app_state
                .workflow_repo
                .find_workflow_for_member(user_id, workflow_id)
                .await;
            match wf {
                Ok(Some(w)) => {
                    let secret = match webhook_secret(app_state.config.as_ref()) {
                        Some(secret) => secret,
                        None => return missing_webhook_secret_response(),
                    };
                    let token = compute_webhook_token(&secret, w.user_id, w.id, new_salt);
                    let signing_key =
                        compute_webhook_signing_key(&secret, w.user_id, w.id, new_salt);
                    let url = format!("/api/workflows/{}/trigger/{}", w.id, token);
                    let triggers = collect_webhook_triggers(&w.data);
                    let mut payload = webhook_url_payload(url, &triggers);
                    if let Some(obj) = payload.as_object_mut() {
                        obj.insert("signing_key".to_string(), json!(signing_key));
                    }
                    (StatusCode::OK, Json(payload)).into_response()
                }
                Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
                Err(e) => {
                    eprintln!("DB error: {:?}", e);
                    JsonResponse::server_error("Failed to regenerate").into_response()
                }
            }
        }
        Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error rotating salt: {:?}", e);
            JsonResponse::server_error("Failed to regenerate").into_response()
        }
    }
}

pub async fn regenerate_webhook_signing_key(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Response {
    // Parse user_id from claims
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => return JsonResponse::unauthorized("Invalid user ID").into_response(),
    };

    // Load workflow (scoped to user)
    let wf = match app_state
        .workflow_repo
        .find_workflow_for_member(user_id, workflow_id)
        .await
    {
        Ok(Some(wf)) => wf,
        Ok(None) => return JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error: {:?}", e);
            return JsonResponse::server_error("Failed to regenerate").into_response();
        }
    };

    let workspace_id = match wf.workspace_id {
        Some(id) => id,
        None => return JsonResponse::not_found("Workflow not in a workspace").into_response(),
    };

    // Load workspace to check plan tier
    let workspace = match app_state.workspace_repo.find_workspace(workspace_id).await {
        Ok(Some(ws)) => ws,
        _ => return JsonResponse::not_found("Workspace not found").into_response(),
    };

    // Premium gating: Solo users cannot regenerate signing keys
    if workspace.plan == "solo" {
        return JsonResponse::forbidden("Webhook signing requires the Workspace plan.")
            .into_response();
    }

    // Generate a new salt and persist it
    let new_salt = match app_state
        .workflow_repo
        .rotate_webhook_salt(user_id, workflow_id)
        .await
    {
        Ok(Some(salt)) => salt,
        Ok(None) => return JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error rotating salt: {:?}", e);
            return JsonResponse::server_error("Failed to regenerate").into_response();
        }
    };

    // Load signing secret from config
    let secret = match webhook_secret(app_state.config.as_ref()) {
        Some(secret) => secret,
        None => return missing_webhook_secret_response(),
    };

    // Compute new token + signing key
    let url_token = compute_webhook_token(&secret, wf.user_id, wf.id, new_salt);
    let signing_key = compute_webhook_signing_key(&secret, wf.user_id, wf.id, new_salt);

    let url = format!("/api/workflows/{}/trigger/{}", wf.id, url_token);

    let triggers = collect_webhook_triggers(&wf.data);
    let mut payload = webhook_url_payload(url, &triggers);
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("signing_key".to_string(), json!(signing_key));
    }

    (StatusCode::OK, Json(payload)).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        Config, OAuthProviderConfig, OAuthSettings, StripeSettings, DEFAULT_WORKSPACE_MEMBER_LIMIT,
        DEFAULT_WORKSPACE_MONTHLY_RUN_LIMIT, RUNAWAY_LIMIT_5MIN,
    };
    use crate::db::{
        mock_db::{MockDb, StaticWorkspaceMembershipRepository},
        mock_stripe_event_log_repository::MockStripeEventLogRepository,
        workflow_repository::{
            CreateWorkflowRunOutcome, MockWorkflowRepository, WorkflowRepository,
        },
        workspace_connection_repository::NoopWorkspaceConnectionRepository,
        workspace_repository::WorkspaceRepository,
    };
    use crate::models::workflow::Workflow;
    use crate::models::workflow_run::WorkflowRun;
    use crate::services::{
        oauth::{
            github::mock_github_oauth::MockGitHubOAuth, google::mock_google_oauth::MockGoogleOAuth,
            workspace_service::WorkspaceOAuthService,
        },
        smtp_mailer::MockMailer,
    };
    use crate::state::{test_pg_pool, AppState};
    use crate::utils::jwt::JwtKeys;
    use axum::body::to_bytes;
    use axum::http::HeaderMap;
    use reqwest::Client;
    use serde_json::{json, Value};
    use std::sync::Arc;
    use time::OffsetDateTime;

    fn test_config() -> Arc<Config> {
        Arc::new(Config {
            database_url: "postgres://localhost/test".into(),
            frontend_origin: "https://app.example.com".into(),
            admin_origin: "https://app.example.com".into(),
            oauth: OAuthSettings {
                google: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "https://app.example.com/oauth/google".into(),
                },
                microsoft: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "https://app.example.com/oauth/microsoft".into(),
                },
                slack: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "https://app.example.com/oauth/slack".into(),
                },
                asana: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "https://app.example.com/oauth/asana".into(),
                },
                token_encryption_key: vec![0; 32],
                require_connection_id: false,
            },
            api_secrets_encryption_key: vec![1; 32],
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

    fn workflow_fixture(workspace_id: Uuid, owner_id: Uuid, data: Value) -> Workflow {
        let now = OffsetDateTime::now_utc();
        Workflow {
            id: Uuid::new_v4(),
            user_id: owner_id,
            workspace_id: Some(workspace_id),
            name: "Workflow".into(),
            description: None,
            data,
            concurrency_limit: 1,
            egress_allowlist: vec![],
            require_hmac: false,
            hmac_replay_window_sec: 300,
            webhook_salt: Uuid::new_v4(),
            locked_by: None,
            locked_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn test_state_with_config(
        config: Arc<Config>,
        workflow_repo: Arc<dyn WorkflowRepository>,
        workspace_repo: Arc<dyn WorkspaceRepository>,
    ) -> AppState {
        AppState {
            db: Arc::new(MockDb::default()),
            workflow_repo,
            workspace_repo,
            workspace_connection_repo: Arc::new(NoopWorkspaceConnectionRepository),
            stripe_event_log_repo: Arc::new(MockStripeEventLogRepository::default()),
            db_pool: test_pg_pool(),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(MockGoogleOAuth::default()),
            github_oauth: Arc::new(MockGitHubOAuth::default()),
            oauth_accounts: crate::services::oauth::account_service::OAuthAccountService::test_stub(
            ),
            workspace_oauth: WorkspaceOAuthService::test_stub(),
            stripe: Arc::new(crate::services::stripe::MockStripeService::new()),
            http_client: Arc::new(Client::new()),
            config,
            worker_id: Arc::new("worker-1".into()),
            worker_lease_seconds: 30,
            jwt_keys: test_jwt_keys(),
        }
    }

    #[tokio::test]
    async fn webhook_trigger_sets_start_node_for_named_trigger() {
        let workspace_id = Uuid::new_v4();
        let owner_id = Uuid::new_v4();
        let data = json!({
            "nodes": [
                {"id": "wh-1", "type": "trigger", "data": {"label": "First", "triggerType": "Webhook"}},
                {"id": "wh-2", "type": "trigger", "data": {"label": "Second", "triggerType": "Webhook"}}
            ],
            "edges": []
        });
        let workflow = workflow_fixture(workspace_id, owner_id, data);

        let mut repo = MockWorkflowRepository::new();
        let wf_for_public = workflow.clone();
        repo.expect_count_workspace_runs_since()
            .returning(|_, _| Box::pin(async { Ok(0) }));
        repo.expect_find_workflow_by_id_public()
            .returning(move |wf_id| {
                let wf = wf_for_public.clone();
                Box::pin(async move {
                    assert_eq!(wf_id, wf.id);
                    Ok(Some(wf))
                })
            });
        repo.expect_create_workflow_run()
            .returning(move |user_id, wf_id, ws_id, snapshot, _| {
                assert_eq!(snapshot.get("_start_from_node"), Some(&json!("wh-2")));
                assert_eq!(snapshot.get("_start_trigger_label"), Some(&json!("Second")));
                assert_eq!(
                    snapshot.get("_trigger_context"),
                    Some(&json!({"hello": "world"}))
                );
                let now = OffsetDateTime::now_utc();
                let run = WorkflowRun {
                    id: Uuid::new_v4(),
                    user_id,
                    workflow_id: wf_id,
                    workspace_id: ws_id,
                    snapshot: snapshot.clone(),
                    status: "queued".into(),
                    error: None,
                    idempotency_key: None,
                    started_at: now,
                    resume_at: now,
                    finished_at: None,
                    created_at: now,
                    updated_at: now,
                };
                Box::pin(async move { Ok(CreateWorkflowRunOutcome { run, created: true }) })
            });

        let workspace_repo: Arc<StaticWorkspaceMembershipRepository> =
            Arc::new(StaticWorkspaceMembershipRepository::allowing());
        let config = test_config();
        let token = compute_webhook_token(
            &config.webhook_secret,
            workflow.user_id,
            workflow.id,
            workflow.webhook_salt,
        );
        let state = test_state_with_config(
            config,
            Arc::new(repo),
            workspace_repo.clone() as Arc<dyn WorkspaceRepository>,
        );

        let response = webhook_trigger(
            State(state),
            Path(WebhookPathParams {
                workflow_id: workflow.id,
                token,
                trigger_label: Some("Second".into()),
            }),
            HeaderMap::new(),
            Some(Json(json!({"hello": "world"}))),
        )
        .await;

        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let body = to_bytes(response.into_body(), 1024).await.unwrap();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["success"], json!(true));
    }

    #[tokio::test]
    async fn webhook_trigger_requires_label_when_multiple() {
        let workspace_id = Uuid::new_v4();
        let owner_id = Uuid::new_v4();
        let data = json!({
            "nodes": [
                {"id": "wh-1", "type": "trigger", "data": {"label": "Alpha", "triggerType": "Webhook"}},
                {"id": "wh-2", "type": "trigger", "data": {"label": "Beta", "triggerType": "Webhook"}}
            ],
            "edges": []
        });
        let workflow = workflow_fixture(workspace_id, owner_id, data);

        let mut repo = MockWorkflowRepository::new();
        let wf_for_public = workflow.clone();
        repo.expect_find_workflow_by_id_public()
            .returning(move |wf_id| {
                let wf = wf_for_public.clone();
                Box::pin(async move {
                    assert_eq!(wf_id, wf.id);
                    Ok(Some(wf))
                })
            });
        repo.expect_create_workflow_run().times(0);

        let workspace_repo: Arc<StaticWorkspaceMembershipRepository> =
            Arc::new(StaticWorkspaceMembershipRepository::allowing());
        let config = test_config();
        let token = compute_webhook_token(
            &config.webhook_secret,
            workflow.user_id,
            workflow.id,
            workflow.webhook_salt,
        );
        let state = test_state_with_config(
            config,
            Arc::new(repo),
            workspace_repo.clone() as Arc<dyn WorkspaceRepository>,
        );

        let response = webhook_trigger(
            State(state),
            Path(WebhookPathParams {
                workflow_id: workflow.id,
                token,
                trigger_label: None,
            }),
            HeaderMap::new(),
            Some(Json(json!({"hello": "world"}))),
        )
        .await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
