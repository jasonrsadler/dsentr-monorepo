use super::prelude::*;

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
            let secret = std::env::var("WEBHOOK_SECRET").unwrap_or_else(|_| "dev-secret".into());
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

    let secret = std::env::var("WEBHOOK_SECRET").unwrap_or_else(|_| "dev-secret".into());
    let expected = compute_webhook_token(&secret, wf.user_id, wf.id, wf.webhook_salt);
    if token != expected {
        return JsonResponse::unauthorized("Invalid token").into_response();
    }

    if wf.require_hmac {
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let signing_key_b64 =
            compute_webhook_signing_key(&secret, wf.user_id, wf.id, wf.webhook_salt);

        let (ts_str, sig_str) = {
            let ts = std::env::var("X_DSENTR_TS_OVERRIDE").ok();
            let sg = std::env::var("X_DSENTR_SIG_OVERRIDE").ok();
            if ts.is_some() && sg.is_some() {
                (ts.unwrap(), sg.unwrap())
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
                (ts_v, sg_v)
            } else {
                (String::new(), String::new())
            }
        };

        if ts_str.is_empty() || sig_str.is_empty() {
            return JsonResponse::unauthorized("Missing HMAC signature").into_response();
        }
        let ts = ts_str.parse::<i64>().unwrap_or(0);
        if ts <= 0 || (now - ts).abs() as i32 > wf.hmac_replay_window_sec {
            return JsonResponse::unauthorized("Stale or invalid timestamp").into_response();
        }

        let raw_body = body
            .as_ref()
            .map(|Json(v)| v.to_string())
            .unwrap_or_else(|| String::from(""));
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

    match app_state
        .workflow_repo
        .create_workflow_run(wf.user_id, wf.id, snapshot, None)
        .await
    {
        Ok(run) => (
            StatusCode::ACCEPTED,
            Json(json!({"success": true, "run": run})),
        )
            .into_response(),
        Err(e) => {
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
            let secret = std::env::var("WEBHOOK_SECRET").unwrap_or_else(|_| "dev-secret".into());
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
                    let secret =
                        std::env::var("WEBHOOK_SECRET").unwrap_or_else(|_| "dev-secret".into());
                    let token = compute_webhook_token(&secret, w.user_id, w.id, new_salt);
                    let url = format!("/api/workflows/{}/trigger/{}", w.id, token);
                    (StatusCode::OK, Json(json!({"success": true, "url": url}))).into_response()
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
