use super::prelude::*;
use crate::config::MIN_WEBHOOK_SECRET_LENGTH;
use crate::{
    routes::plan_limits::workspace_limit_error_response, state::WorkspaceRunQuotaTicket,
    utils::plan_limits::NormalizedPlanTier,
};
use axum::http::HeaderMap;
use tracing::error;

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
        .find_workflow_by_id(user_id, workflow_id)
        .await
    {
        Ok(Some(wf)) => {
            let secret = match webhook_secret(app_state.config.as_ref()) {
                Some(secret) => secret,
                None => return missing_webhook_secret_response(),
            };
            let token = compute_webhook_token(&secret, wf.user_id, wf.id, wf.webhook_salt);
            let url = format!("/api/workflows/{}/trigger/{}", wf.id, token);
            (StatusCode::OK, Json(json!({"success": true, "url": url }))).into_response()
        }
        Ok(None) => JsonResponse::not_found("Workflow not found").into_response(),
        Err(e) => {
            eprintln!("DB error: {:?}", e);
            JsonResponse::server_error("Failed to get webhook URL").into_response()
        }
    }
}

pub async fn webhook_trigger(
    State(app_state): State<AppState>,
    Path((workflow_id, token)): Path<(Uuid, String)>,
    headers: HeaderMap,
    body: Option<Json<serde_json::Value>>,
) -> Response {
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

    let trigger_type = wf
        .data
        .get("nodes")
        .and_then(|arr| arr.as_array())
        .and_then(|nodes| {
            nodes
                .iter()
                .find(|n| n.get("type").and_then(|t| t.as_str()) == Some("trigger"))
        })
        .and_then(|trigger| {
            trigger
                .get("data")
                .and_then(|d| d.get("triggerType"))
                .and_then(|t| t.as_str())
        });

    if trigger_type != Some("Webhook") {
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

    let mut snapshot = wf.data.clone();
    if let Some(Json(ctx)) = body {
        snapshot["_trigger_context"] = ctx;
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
            Ok(ticket) => workspace_quota = Some(ticket),
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
            (
                StatusCode::ACCEPTED,
                Json(json!({"success": true, "run": outcome.run})),
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
        .find_workflow_by_id(user_id, workflow_id)
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
        .find_workflow_by_id(user_id, workflow_id)
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
                .find_workflow_by_id(user_id, workflow_id)
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
                    (
                        StatusCode::OK,
                        Json(json!({"success": true, "url": url, "signing_key": signing_key})),
                    )
                        .into_response()
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
        .find_workflow_by_id(user_id, workflow_id)
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

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "signing_key": signing_key,
            "url": url
        })),
    )
        .into_response()
}
