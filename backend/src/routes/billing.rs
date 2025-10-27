use axum::{extract::State, http::HeaderMap, response::IntoResponse};
use axum::{http::StatusCode, response::Response};
use axum::{Json};
use serde_json::json;
use tracing::{error, info, warn};

use crate::responses::JsonResponse;
use crate::state::AppState;

// Helper: extract a simple string from a nested json path
fn jget<'a>(val: &'a serde_json::Value, path: &[&str]) -> Option<&'a serde_json::Value> {
    let mut cur = val;
    for key in path {
        cur = cur.get(*key)?;
    }
    Some(cur)
}

fn extract_customer_id(event: &serde_json::Value) -> Option<String> {
    // Common Stripe shapes: { data: { object: { customer: "cus_..." } } }
    jget(event, &["data", "object", "customer"])?
        .as_str()
        .map(|s| s.to_string())
}

fn extract_checkout_user_id(event: &serde_json::Value) -> Option<uuid::Uuid> {
    // checkout.session payload shape
    let obj = jget(event, &["data", "object"])?.clone();
    // Prefer explicit metadata.user_id
    if let Some(uid) = obj.get("metadata").and_then(|m| m.get("user_id")).and_then(|v| v.as_str()) {
        if let Ok(id) = uuid::Uuid::parse_str(uid) {
            return Some(id);
        }
    }
    // Fallback to client_reference_id (we set it to user_id string)
    if let Some(id_str) = obj.get("client_reference_id").and_then(|v| v.as_str()) {
        if let Ok(id) = uuid::Uuid::parse_str(id_str) {
            return Some(id);
        }
    }
    None
}

fn extract_failure_message(event: &serde_json::Value) -> Option<String> {
    // Try PaymentIntent last_payment_error.message
    if let Some(msg) = jget(event, &["data", "object", "last_payment_error", "message"]) {
        if let Some(s) = msg.as_str() {
            return Some(s.to_string());
        }
    }
    // Try invoice.last_finalization_error.message if present
    if let Some(msg) = jget(event, &["data", "object", "last_finalization_error", "message"]) {
        if let Some(s) = msg.as_str() {
            return Some(s.to_string());
        }
    }
    // Generic fallback per event type
    None
}

pub async fn stripe_webhook(
    State(app_state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let sig = match headers.get("Stripe-Signature").and_then(|h| h.to_str().ok()) {
        Some(s) => s,
        None => return JsonResponse::bad_request("Missing Stripe-Signature").into_response(),
    };

    let evt = match app_state.stripe.verify_webhook(&body, sig) {
        Ok(e) => e,
        Err(err) => {
            warn!(?err, "stripe webhook verification failed");
            return (StatusCode::BAD_REQUEST, "invalid webhook").into_response();
        }
    };

    let evt_type = evt.r#type.as_str();
    let payload = &evt.payload;

    // Handle failure-style events: payment intent failure, invoice failure, checkout session async failure/expired
    let is_failure = matches!(
        evt_type,
        "payment_intent.payment_failed"
            | "invoice.payment_failed"
            | "checkout.session.async_payment_failed"
            | "checkout.session.expired"
    );

    if is_failure {
        let mut user_id: Option<uuid::Uuid> = None;
        if evt_type.starts_with("checkout.session") {
            user_id = extract_checkout_user_id(payload);
        }

        if user_id.is_none() {
            if let Some(customer_id) = extract_customer_id(payload) {
                match app_state
                    .db
                    .find_user_id_by_stripe_customer_id(&customer_id)
                    .await
                {
                    Ok(opt) => {
                        user_id = opt;
                    }
                    Err(err) => {
                        error!(?err, customer_id, "failed to map stripe customer to user");
                    }
                }
            }
        }

        if let Some(uid) = user_id {
            let msg = extract_failure_message(payload).unwrap_or_else(|| {
                "Payment failed. Please update your card or try again.".to_string()
            });
            if let Err(err) = app_state
                .db
                .clear_pending_checkout_with_error(uid, &msg)
                .await
            {
                error!(?err, %uid, "failed to record checkout failure in settings");
            }

            // As a safety: ensure the personal plan field is not left as workspace
            // We avoid touching any joined workspaces; only reset the user's personal plan.
            if let Ok(Some(user)) = app_state.db.find_public_user_by_id(uid).await {
                if user.plan.as_deref() == Some("workspace") {
                    if let Err(err) = app_state.db.update_user_plan(uid, "solo").await {
                        warn!(?err, %uid, "failed to rollback user plan to solo");
                    }
                }
            }

            // Downgrade any owned workspaces back to solo to ensure consistency
            if let Ok(memberships) = app_state.workspace_repo.list_memberships_for_user(uid).await {
                for m in memberships
                    .into_iter()
                    .filter(|m| m.workspace.owner_id == uid && m.workspace.plan.as_str() != "solo")
                {
                    if let Err(err) = app_state
                        .workspace_repo
                        .update_workspace_plan(m.workspace.id, "solo")
                        .await
                    {
                        warn!(?err, workspace_id=%m.workspace.id, %uid, "failed to rollback workspace plan to solo");
                    }
                }
            }

            warn!(%uid, evt_type, "recorded billing failure and cleared pending checkout");
        } else {
            warn!(evt_type, "billing failure event received but user not identified");
        }

        return Json(json!({ "received": true })).into_response();
    }

    // For non-failure events, acknowledge without action for now
    info!(evt_type, "unhandled stripe event acknowledged");
    Json(json!({ "received": true })).into_response()
}
