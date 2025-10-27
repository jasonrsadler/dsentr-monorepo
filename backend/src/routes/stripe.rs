use axum::{extract::State, http::HeaderMap, response::IntoResponse};
use axum::{http::StatusCode, response::Response};
use axum::Json;
use time::OffsetDateTime;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::models::workspace::WorkspaceRole;
use crate::responses::JsonResponse;
use crate::state::AppState;

// Small helper: nested json lookup
fn jget<'a>(val: &'a serde_json::Value, path: &[&str]) -> Option<&'a serde_json::Value> {
    let mut cur = val;
    for key in path {
        cur = cur.get(*key)?;
    }
    Some(cur)
}

fn extract_str<'a>(val: &'a serde_json::Value, path: &[&str]) -> Option<&'a str> {
    jget(val, path)?.as_str()
}

fn extract_checkout_user_id(event: &serde_json::Value) -> Option<Uuid> {
    // checkout.session payload shape
    let obj = jget(event, &["data", "object"])?.clone();
    if let Some(uid) = obj.get("metadata").and_then(|m| m.get("user_id")).and_then(|v| v.as_str()) {
        if let Ok(id) = Uuid::parse_str(uid) {
            return Some(id);
        }
    }
    if let Some(id_str) = obj.get("client_reference_id").and_then(|v| v.as_str()) {
        if let Ok(id) = Uuid::parse_str(id_str) {
            return Some(id);
        }
    }
    None
}

fn extract_customer_id(event: &serde_json::Value) -> Option<String> {
    extract_str(event, &["data", "object", "customer"]).map(|s| s.to_string())
}

fn extract_session_id(event: &serde_json::Value) -> Option<String> {
    extract_str(event, &["data", "object", "id"]).map(|s| s.to_string())
}

fn extract_failure_message(event: &serde_json::Value) -> Option<String> {
    // Try PaymentIntent last_payment_error.message
    if let Some(val) = jget(event, &["data", "object", "last_payment_error", "message"]) {
        if let Some(s) = val.as_str() {
            return Some(s.to_string());
        }
    }
    // Try invoice.last_finalization_error.message
    if let Some(val) = jget(event, &["data", "object", "last_finalization_error", "message"]) {
        if let Some(s) = val.as_str() {
            return Some(s.to_string());
        }
    }
    None
}

// POST /api/stripe/webhook
pub async fn webhook(
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

    match evt_type {
        // Primary success signal for Checkout-based upgrades
        "checkout.session.completed" => {
            let session_id = match extract_session_id(payload) {
                Some(id) => id,
                None => {
                    warn!("checkout.session.completed missing session id");
                    return Json(serde_json::json!({ "received": true })).into_response();
                }
            };

            // Resolve user
            let mut user_id: Option<Uuid> = extract_checkout_user_id(payload);
            if user_id.is_none() {
                if let Some(customer_id) = extract_customer_id(payload) {
                    match app_state.db.find_user_id_by_stripe_customer_id(&customer_id).await {
                        Ok(opt) => user_id = opt,
                        Err(err) => error!(?err, customer_id, "failed to map stripe customer to user"),
                    }
                }
            }

            let user_id = match user_id {
                Some(id) => id,
                None => {
                    warn!(evt_type, "unable to resolve user for checkout completion");
                    return Json(serde_json::json!({ "received": true })).into_response();
                }
            };

            // Load user settings and confirm pending checkout session id to ensure idempotency
            let mut settings = match app_state.db.get_user_settings(user_id).await {
                Ok(val) => val,
                Err(err) => {
                    error!(?err, %user_id, "failed to load user settings for checkout completion");
                    return Json(serde_json::json!({ "received": true })).into_response();
                }
            };

            let mut proceed = false;
            let mut workspace_name_opt: Option<String> = None;
            let mut shared_workflow_ids: Vec<Uuid> = Vec::new();
            if let Some(root) = settings.as_object() {
                if let Some(billing) = root.get("billing").and_then(|b| b.as_object()) {
                    if let Some(pending) = billing.get("pending_checkout") {
                        if let Some(pending_obj) = pending.as_object() {
                            let matches = pending_obj
                                .get("session_id")
                                .and_then(|v| v.as_str())
                                .map(|sid| sid == session_id)
                                .unwrap_or(false);
                            if matches {
                                proceed = true;
                                workspace_name_opt = pending_obj
                                    .get("workspace_name")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string());
                                if let Some(arr) = pending_obj.get("shared_workflow_ids").and_then(|v| v.as_array()) {
                                    for v in arr {
                                        if let Some(s) = v.as_str() {
                                            if let Ok(id) = Uuid::parse_str(s) {
                                                shared_workflow_ids.push(id);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if !proceed {
                // Already processed or not our session; acknowledge and no-op for idempotency
                info!(%user_id, %session_id, "ignoring checkout completion without pending session");
                return Json(serde_json::json!({ "received": true })).into_response();
            }

            // Prefer workspace name from settings; fallback to metadata
            if workspace_name_opt.is_none() {
                if let Some(name) = extract_str(payload, &["data", "object", "metadata", "workspace_name"]) {
                    workspace_name_opt = Some(name.to_string());
                }
            }
            let workspace_name = workspace_name_opt.unwrap_or_else(|| "My Workspace".to_string());

            // Persist customer id if present
            if let Some(customer_id) = extract_customer_id(payload) {
                if let Err(err) = app_state
                    .db
                    .set_user_stripe_customer_id(user_id, &customer_id)
                    .await
                {
                    warn!(?err, %user_id, customer_id, "failed to persist stripe customer id on checkout completion");
                }
            }

            // Create personal workspace at workspace tier and assign owner
            let workspace = match app_state
                .workspace_repo
                .create_workspace(&workspace_name, user_id, "workspace")
                .await
            {
                Ok(ws) => ws,
                Err(err) => {
                    error!(?err, %user_id, workspace_name, "failed to create workspace on checkout completion");
                    return Json(serde_json::json!({ "received": true })).into_response();
                }
            };

            if let Err(err) = app_state
                .workspace_repo
                .add_member(workspace.id, user_id, WorkspaceRole::Owner)
                .await
            {
                warn!(?err, %user_id, workspace_id=%workspace.id, "failed to add owner membership (may already exist)");
            }

            // Promote personal plan to workspace
            if let Err(err) = app_state.db.update_user_plan(user_id, "workspace").await {
                warn!(?err, %user_id, "failed to set user plan to workspace");
            }

            // Share requested workflows into the new workspace (if any were recorded)
            for wid in shared_workflow_ids {
                if let Err(err) = app_state
                    .workflow_repo
                    .set_workflow_workspace(user_id, wid, Some(workspace.id))
                    .await
                    .map(|_| ())
                {
                    warn!(?err, %user_id, workflow_id=%wid, workspace_id=%workspace.id, "failed to share workflow during upgrade");
                }
            }

            // Mark onboarding complete if not already
            if let Err(err) = app_state
                .db
                .mark_workspace_onboarded(user_id, OffsetDateTime::now_utc())
                .await
            {
                // Not fatal
                warn!(?err, %user_id, "failed to mark onboarding complete");
            }

            // Clear pending checkout and any prior error state
            if let Some(root) = settings.as_object_mut() {
                root.entry("billing").or_insert_with(|| serde_json::json!({}));
                if let Some(billing) = root.get_mut("billing").and_then(|b| b.as_object_mut()) {
                    billing.insert("pending_checkout".to_string(), serde_json::Value::Null);
                    billing.remove("last_error");
                    billing.remove("last_error_at");
                }
            }
            if let Err(err) = app_state.db.update_user_settings(user_id, settings).await {
                warn!(?err, %user_id, "failed to clear pending checkout after completion");
            }

            info!(%user_id, workspace_id=%workspace.id, %session_id, "completed workspace upgrade");
            Json(serde_json::json!({ "received": true })).into_response()
        }

        // Handle failure-style events: payment intent failure, invoice failure, async failure/expired
        "payment_intent.payment_failed"
        | "invoice.payment_failed"
        | "checkout.session.async_payment_failed"
        | "checkout.session.expired" => {
            let mut user_id: Option<Uuid> = None;
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
                        Ok(opt) => user_id = opt,
                        Err(err) => error!(?err, customer_id, "failed to map stripe customer to user"),
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

                // Roll back personal plan if necessary
                if let Ok(Some(user)) = app_state.db.find_public_user_by_id(uid).await {
                    if user.plan.as_deref() == Some("workspace") {
                        if let Err(err) = app_state.db.update_user_plan(uid, "solo").await {
                            warn!(?err, %uid, "failed to rollback user plan to solo");
                        }
                    }
                }

                // Downgrade any owned workspaces back to solo
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

            Json(serde_json::json!({ "received": true })).into_response()
        }

        // Subscription canceled at period end -> revert user back to solo
        "customer.subscription.deleted" => {
            // Resolve user by customer id
            let mut user_id: Option<Uuid> = None;
            if let Some(customer_id) = extract_customer_id(payload) {
                match app_state.db.find_user_id_by_stripe_customer_id(&customer_id).await {
                    Ok(opt) => user_id = opt,
                    Err(err) => error!(?err, customer_id, "failed to map stripe customer to user for subscription deletion"),
                }
            }

            if let Some(uid) = user_id {
                // Update personal plan back to solo
                if let Err(err) = app_state.db.update_user_plan(uid, "solo").await {
                    warn!(?err, %uid, "failed to set user plan to solo on subscription deletion");
                }

                // Downgrade any owned workspaces back to solo
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
                            warn!(?err, workspace_id=%m.workspace.id, %uid, "failed to downgrade workspace to solo on subscription deletion");
                        }
                    }
                }

                info!(%uid, "processed subscription deletion: reverted plan to solo");
            } else {
                warn!(evt_type, "subscription deletion received but user not identified");
            }

            Json(serde_json::json!({ "received": true })).into_response()
        }

        // Other events acknowledged to avoid retries; primary logic handled above.
        _ => {
            info!(evt_type, "unhandled stripe event acknowledged");
            Json(serde_json::json!({ "received": true })).into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, OAuthProviderConfig, OAuthSettings, StripeSettings};
    use crate::db::mock_db::{MockDb, NoopWorkflowRepository};
    use crate::db::workspace_repository::WorkspaceRepository;
    use crate::models::user::{OauthProvider, User, UserRole};
    use crate::models::workspace::{Workspace, WorkspaceMember, WorkspaceMembershipSummary, WorkspaceRole};
    use crate::services::smtp_mailer::MockMailer;
    use crate::services::stripe::MockStripeService;
    use crate::state::AppState;
    use axum::extract::State as AxumState;
    use axum::http::{HeaderMap, HeaderValue};
    use reqwest::Client;
    use time::OffsetDateTime;
    use std::sync::{Arc, Mutex};
    use uuid::Uuid;

    #[derive(Clone, Default)]
    struct TestWorkspaceRepo {
        workspaces: Arc<Mutex<Vec<Workspace>>>,
        created: Arc<Mutex<Vec<Workspace>>>,
        added_members: Arc<Mutex<Vec<(Uuid, Uuid, WorkspaceRole)>>>,
        memberships: Arc<Mutex<Vec<WorkspaceMembershipSummary>>>,
        plan_updates: Arc<Mutex<Vec<(Uuid, String)>>>,
    }

    #[async_trait::async_trait]
    impl WorkspaceRepository for TestWorkspaceRepo {
        async fn create_workspace(&self, name: &str, created_by: Uuid, plan: &str) -> Result<Workspace, sqlx::Error> {
            let now = OffsetDateTime::now_utc();
            let ws = Workspace { id: Uuid::new_v4(), name: name.to_string(), created_by, owner_id: created_by, plan: plan.to_string(), created_at: now, updated_at: now, deleted_at: None };
            self.created.lock().unwrap().push(ws.clone());
            self.workspaces.lock().unwrap().push(ws.clone());
            Ok(ws)
        }

        async fn update_workspace_name(&self, _workspace_id: Uuid, _name: &str) -> Result<Workspace, sqlx::Error> { unimplemented!() }

        async fn update_workspace_plan(&self, workspace_id: Uuid, plan: &str) -> Result<Workspace, sqlx::Error> {
            let mut list = self.workspaces.lock().unwrap();
            if let Some(ws) = list.iter_mut().find(|w| w.id == workspace_id) {
                ws.plan = plan.to_string();
                ws.updated_at = OffsetDateTime::now_utc();
                self.plan_updates.lock().unwrap().push((workspace_id, plan.to_string()));
                Ok(ws.clone())
            } else {
                // In tests, we may not have seeded the workspace list; still record the update
                let now = OffsetDateTime::now_utc();
                let ws = Workspace {
                    id: workspace_id,
                    name: "test".into(),
                    created_by: Uuid::nil(),
                    owner_id: Uuid::nil(),
                    plan: plan.to_string(),
                    created_at: now,
                    updated_at: now,
                    deleted_at: None,
                };
                list.push(ws.clone());
                self.plan_updates.lock().unwrap().push((workspace_id, plan.to_string()));
                Ok(ws)
            }
        }

        async fn find_workspace(&self, _workspace_id: Uuid) -> Result<Option<Workspace>, sqlx::Error> { Ok(None) }

        async fn add_member(&self, workspace_id: Uuid, user_id: Uuid, role: WorkspaceRole) -> Result<(), sqlx::Error> {
            self.added_members.lock().unwrap().push((workspace_id, user_id, role));
            Ok(())
        }

        async fn set_member_role(&self, _workspace_id: Uuid, _user_id: Uuid, _role: WorkspaceRole) -> Result<(), sqlx::Error> { Ok(()) }
        async fn remove_member(&self, _workspace_id: Uuid, _user_id: Uuid) -> Result<(), sqlx::Error> { Ok(()) }
        async fn leave_workspace(&self, _workspace_id: Uuid, _user_id: Uuid) -> Result<(), sqlx::Error> { Ok(()) }
        async fn revoke_member(&self, _workspace_id: Uuid, _member_id: Uuid, _revoked_by: Uuid, _reason: Option<&str>) -> Result<(), sqlx::Error> { Ok(()) }
        async fn list_members(&self, _workspace_id: Uuid) -> Result<Vec<WorkspaceMember>, sqlx::Error> { Ok(vec![]) }
        async fn list_memberships_for_user(&self, _user_id: Uuid) -> Result<Vec<WorkspaceMembershipSummary>, sqlx::Error> { Ok(self.memberships.lock().unwrap().clone()) }
        async fn list_user_workspaces(&self, _user_id: Uuid) -> Result<Vec<WorkspaceMembershipSummary>, sqlx::Error> { Ok(vec![]) }
        async fn create_workspace_invitation(&self, _workspace_id: Uuid, _email: &str, _role: WorkspaceRole, _token: &str, _expires_at: OffsetDateTime, _created_by: Uuid) -> Result<crate::models::workspace::WorkspaceInvitation, sqlx::Error> { unimplemented!() }
        async fn list_workspace_invitations(&self, _workspace_id: Uuid) -> Result<Vec<crate::models::workspace::WorkspaceInvitation>, sqlx::Error> { Ok(vec![]) }
        async fn revoke_workspace_invitation(&self, _invite_id: Uuid) -> Result<(), sqlx::Error> { Ok(()) }
        async fn find_invitation_by_token(&self, _token: &str) -> Result<Option<crate::models::workspace::WorkspaceInvitation>, sqlx::Error> { Ok(None) }
        async fn mark_invitation_accepted(&self, _invite_id: Uuid) -> Result<(), sqlx::Error> { Ok(()) }
        async fn mark_invitation_declined(&self, _invite_id: Uuid) -> Result<(), sqlx::Error> { Ok(()) }
        async fn list_pending_invitations_for_email(&self, _email: &str) -> Result<Vec<crate::models::workspace::WorkspaceInvitation>, sqlx::Error> { Ok(vec![]) }
    }

    fn test_config() -> Arc<Config> {
        Arc::new(Config {
            database_url: String::new(),
            frontend_origin: "https://app.example.com".into(),
            oauth: OAuthSettings {
                google: OAuthProviderConfig { client_id: "client".into(), client_secret: "secret".into(), redirect_uri: "https://app.example.com/oauth/google".into() },
                microsoft: OAuthProviderConfig { client_id: "client".into(), client_secret: "secret".into(), redirect_uri: "https://app.example.com/oauth/microsoft".into() },
                slack: OAuthProviderConfig { client_id: "client".into(), client_secret: "secret".into(), redirect_uri: "https://app.example.com/oauth/slack".into() },
                token_encryption_key: vec![0; 32],
            },
            stripe: StripeSettings { client_id: "stub".into(), secret_key: "stub".into(), webhook_secret: "stub".into() },
        })
    }

    #[tokio::test]
    async fn webhook_checkout_session_completed_creates_workspace_and_clears_pending() {
        let user_id = Uuid::new_v4();
        let session_id = "cs_test_123";
        let db = Arc::new(MockDb {
            find_user_result: Some(User {
                id: user_id,
                email: "owner@example.com".into(),
                password_hash: String::new(),
                first_name: "Owner".into(),
                last_name: "User".into(),
                role: Some(UserRole::User),
                plan: None,
                company_name: None,
                stripe_customer_id: None,
                oauth_provider: Some(OauthProvider::Email),
                onboarded_at: None,
                created_at: OffsetDateTime::now_utc(),
            }),
            ..Default::default()
        });

        // Seed pending checkout
        {
            let mut settings = db.user_settings.lock().unwrap();
            *settings = serde_json::json!({
                "billing": {
                    "pending_checkout": {
                        "session_id": session_id,
                        "plan_tier": "workspace",
                        "workspace_name": "Acme Co"
                    }
                }
            });
        }

        let workspace_repo = Arc::new(TestWorkspaceRepo::default());
        let stripe = Arc::new(MockStripeService::new());
        let state = AppState {
            db: db.clone(),
            workflow_repo: Arc::new(NoopWorkflowRepository),
            workspace_repo: workspace_repo.clone(),
            workspace_connection_repo: Arc::new(crate::db::workspace_connection_repository::NoopWorkspaceConnectionRepository),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(crate::services::oauth::google::mock_google_oauth::MockGoogleOAuth::default()),
            github_oauth: Arc::new(crate::services::oauth::github::mock_github_oauth::MockGitHubOAuth::default()),
            oauth_accounts: crate::services::oauth::account_service::OAuthAccountService::test_stub(),
            workspace_oauth: crate::services::oauth::workspace_service::WorkspaceOAuthService::test_stub(),
            stripe: stripe.clone(),
            http_client: Arc::new(Client::new()),
            config: test_config(),
            worker_id: Arc::new("test-worker".into()),
            worker_lease_seconds: 30,
        };

        // Build webhook payload that MockStripeService will accept without signature verification
        let body = serde_json::json!({
            "id": "evt_123",
            "type": "checkout.session.completed",
            "data": { "object": { "id": session_id, "metadata": { "user_id": user_id.to_string(), "workspace_name": "Acme Co" }, "customer": "cus_123" } }
        });
        let mut headers = HeaderMap::new();
        headers.insert("Stripe-Signature", HeaderValue::from_static("t=1,v1=stub"));

        let resp = webhook(AxumState(state), headers, axum::body::Bytes::from(serde_json::to_vec(&body).unwrap())).await;
        assert_eq!(resp.status(), StatusCode::OK);

        // User plan updated via webhook
        assert_eq!(*db.update_user_plan_calls.lock().unwrap(), 1);

        // Pending checkout cleared
        let settings = db.user_settings.lock().unwrap().clone();
        assert!(settings["billing"]["pending_checkout"].is_null());

        // Workspace created and owner membership added
        let created = workspace_repo.created.lock().unwrap().clone();
        assert_eq!(created.len(), 1);
        let added = workspace_repo.added_members.lock().unwrap().clone();
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].1, user_id);
    }

    #[tokio::test]
    async fn webhook_billing_failure_records_error_and_rolls_back() {
        let user_id = Uuid::new_v4();
        let workspace_id = Uuid::new_v4();
        let repo = TestWorkspaceRepo::default();
        // Seed a membership for rollback path
        repo.memberships.lock().unwrap().push(WorkspaceMembershipSummary {
            workspace: Workspace {
                id: workspace_id,
                name: "Team".into(),
                created_by: user_id,
                owner_id: user_id,
                plan: "workspace".into(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
                deleted_at: None,
            },
            role: WorkspaceRole::Owner,
        });
        let workspace_repo = Arc::new(repo);

        let db = Arc::new(MockDb {
            find_user_result: Some(User {
                id: user_id,
                email: "owner@example.com".into(),
                password_hash: String::new(),
                first_name: "Owner".into(),
                last_name: "User".into(),
                role: Some(UserRole::User),
                plan: Some("workspace".into()),
                company_name: None,
                stripe_customer_id: Some("cus_abc".into()),
                oauth_provider: Some(OauthProvider::Email),
                onboarded_at: None,
                created_at: OffsetDateTime::now_utc(),
            }),
            ..Default::default()
        });
        // Seed mapping for customer -> user id resolution used by failure paths
        {
            let mut guard = db.stripe_customer_id.lock().unwrap();
            *guard = Some("cus_abc".into());
        }
        // Seed a pending checkout
        {
            let mut settings = db.user_settings.lock().unwrap();
            *settings = serde_json::json!({"billing": {"pending_checkout": {"session_id": "cs_test_old"}}});
        }

        let stripe = Arc::new(MockStripeService::new());
        let state = AppState {
            db: db.clone(),
            workflow_repo: Arc::new(NoopWorkflowRepository),
            workspace_repo: workspace_repo.clone(),
            workspace_connection_repo: Arc::new(crate::db::workspace_connection_repository::NoopWorkspaceConnectionRepository),
            mailer: Arc::new(MockMailer::default()),
            google_oauth: Arc::new(crate::services::oauth::google::mock_google_oauth::MockGoogleOAuth::default()),
            github_oauth: Arc::new(crate::services::oauth::github::mock_github_oauth::MockGitHubOAuth::default()),
            oauth_accounts: crate::services::oauth::account_service::OAuthAccountService::test_stub(),
            workspace_oauth: crate::services::oauth::workspace_service::WorkspaceOAuthService::test_stub(),
            stripe: stripe.clone(),
            http_client: Arc::new(Client::new()),
            config: test_config(),
            worker_id: Arc::new("test-worker".into()),
            worker_lease_seconds: 30,
        };

        // Use an invoice.payment_failed shape to drive failure path
        let body = serde_json::json!({
            "id": "evt_fail",
            "type": "invoice.payment_failed",
            "data": { "object": { "customer": "cus_abc", "last_finalization_error": { "message": "Card declined" } } }
        });
        let mut headers = HeaderMap::new();
        headers.insert("Stripe-Signature", HeaderValue::from_static("t=1,v1=stub"));

        let resp = webhook(AxumState(state), headers, axum::body::Bytes::from(serde_json::to_vec(&body).unwrap())).await;
        assert_eq!(resp.status(), StatusCode::OK);

        // Settings cleared pending and recorded error
        let settings = db.user_settings.lock().unwrap().clone();
        assert!(settings["billing"]["pending_checkout"].is_null());
        assert_eq!(settings["billing"]["last_error"].as_str().unwrap_or(""), "Card declined");

        // Personal plan rolled back and any owned workspace downgraded
        assert_eq!(*db.update_user_plan_calls.lock().unwrap(), 1);
        // At least one workspace plan update recorded
        assert!(!workspace_repo.plan_updates.lock().unwrap().is_empty());
    }
}
