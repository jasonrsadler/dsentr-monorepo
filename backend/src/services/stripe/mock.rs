#![allow(dead_code)]
use super::{
    CheckoutSession, CreateCheckoutSessionRequest, StripeEvent, StripeService, StripeServiceError,
    SubscriptionInfo,
};
use async_trait::async_trait;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Default)]
pub struct MockStripeService {
    pub created_sessions: Arc<Mutex<Vec<CheckoutSession>>>,
    pub last_create_requests: Arc<Mutex<Vec<CreateCheckoutSessionRequest>>>,
    pub events: Arc<Mutex<Vec<StripeEvent>>>,
    pub active_subscription: Arc<Mutex<Option<SubscriptionInfo>>>,
}

impl MockStripeService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_active_subscription(self, period_end: i64) -> Self {
        let sub = SubscriptionInfo {
            id: make_id("sub_test"),
            status: "active".into(),
            current_period_end: period_end,
            cancel_at: None,
            cancel_at_period_end: false,
        };
        *self.active_subscription.lock().unwrap() = Some(sub);
        self
    }
}

fn make_id(prefix: &str) -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}_{}", prefix, ts)
}

#[async_trait]
impl StripeService for MockStripeService {
    async fn create_checkout_session(
        &self,
        req: CreateCheckoutSessionRequest,
    ) -> Result<CheckoutSession, StripeServiceError> {
        // capture the request
        self.last_create_requests.lock().unwrap().push(req.clone());

        // synthesize a session
        let session = CheckoutSession {
            id: make_id("cs_test"),
            url: Some("https://example.test/checkout".into()),
        };
        self.created_sessions.lock().unwrap().push(session.clone());
        Ok(session)
    }

    async fn create_customer(
        &self,
        email: &str,
        _name: Option<&str>,
    ) -> Result<String, StripeServiceError> {
        // generate a deterministic-ish id
        let id = make_id("cus_test");
        // record an event-like payload for observability in tests
        let evt = StripeEvent {
            id: id.clone(),
            r#type: "customer.created".into(),
            payload: serde_json::json!({ "email": email, "id": id.clone() }),
        };
        self.events.lock().unwrap().push(evt);
        Ok(id)
    }

    fn verify_webhook(
        &self,
        payload: &[u8],
        _signature_header: &str,
    ) -> Result<StripeEvent, StripeServiceError> {
        let val: serde_json::Value = serde_json::from_slice(payload)
            .map_err(|e| StripeServiceError::Serde(e.to_string()))?;
        let id = match val.get("id").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => make_id("evt"),
        };
        let ty = val
            .get("type")
            .or_else(|| val.get("type_"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let evt = StripeEvent {
            id,
            r#type: ty,
            payload: val,
        };
        self.events.lock().unwrap().push(evt.clone());
        Ok(evt)
    }

    async fn retrieve_event(&self, event_id: &str) -> Result<StripeEvent, StripeServiceError> {
        let opt = self
            .events
            .lock()
            .unwrap()
            .iter()
            .find(|e| e.id == event_id)
            .cloned();
        opt.ok_or_else(|| StripeServiceError::NotFound(format!("event {} not found", event_id)))
    }

    async fn get_active_subscription_for_customer(
        &self,
        _customer_id: &str,
    ) -> Result<Option<SubscriptionInfo>, StripeServiceError> {
        Ok(self.active_subscription.lock().unwrap().clone())
    }

    async fn set_subscription_cancel_at_period_end(
        &self,
        subscription_id: &str,
        cancel_at_period_end: bool,
    ) -> Result<SubscriptionInfo, StripeServiceError> {
        let mut guard = self.active_subscription.lock().unwrap();
        let mut sub = guard.clone().unwrap_or(SubscriptionInfo {
            id: subscription_id.to_string(),
            status: "active".into(),
            current_period_end: 0,
            cancel_at: None,
            cancel_at_period_end: false,
        });
        sub.cancel_at_period_end = cancel_at_period_end;
        if cancel_at_period_end && sub.cancel_at.is_none() && sub.current_period_end > 0 {
            sub.cancel_at = Some(sub.current_period_end);
        }
        *guard = Some(sub.clone());
        Ok(sub)
    }
}
