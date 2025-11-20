#![allow(dead_code)]
// NOTE: async-stripe is compiled with a minimal feature set (runtime-tokio-hyper, checkout,
// webhook-events, and connect to satisfy webhook payload types). Touching APIs outside those
// features will require updating backend/Cargo.toml explicitly so we keep compile times and binary
// size in check.
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum StripeServiceError {
    #[error("stripe api error: {0}")]
    Api(String),
    #[error("webhook verification failed: {0}")]
    Webhook(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("config error: {0}")]
    Config(String),
    #[error("serialization error: {0}")]
    Serde(String),
    #[error("other error: {0}")]
    Other(String),
}

impl From<stripe::StripeError> for StripeServiceError {
    fn from(err: stripe::StripeError) -> Self {
        StripeServiceError::Api(err.to_string())
    }
}

impl From<stripe::WebhookError> for StripeServiceError {
    fn from(err: stripe::WebhookError) -> Self {
        StripeServiceError::Webhook(err.to_string())
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CheckoutMode {
    Payment,
    Subscription,
    Setup,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CheckoutLineItem {
    pub price: String,
    pub quantity: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateCheckoutSessionRequest {
    pub success_url: String,
    pub cancel_url: String,
    pub mode: CheckoutMode,
    pub line_items: Vec<CheckoutLineItem>,
    pub client_reference_id: Option<String>,
    pub customer: Option<String>,
    pub metadata: Option<std::collections::BTreeMap<String, String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CheckoutSession {
    pub id: String,
    pub url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StripeEvent {
    pub id: String,
    pub r#type: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SubscriptionInfo {
    pub id: String,
    pub status: String,
    /// Unix timestamp (seconds) when the current period started
    pub current_period_start: i64,
    /// Unix timestamp (seconds) when the current period ends
    pub current_period_end: i64,
    /// Unix timestamp (seconds) when the subscription will cancel, if set
    pub cancel_at: Option<i64>,
    pub cancel_at_period_end: bool,
}

#[async_trait]
pub trait StripeService: Send + Sync {
    async fn create_checkout_session(
        &self,
        req: CreateCheckoutSessionRequest,
    ) -> Result<CheckoutSession, StripeServiceError>;

    async fn create_customer(
        &self,
        email: &str,
        name: Option<&str>,
    ) -> Result<String, StripeServiceError>;

    fn verify_webhook(
        &self,
        payload: &[u8],
        signature_header: &str,
    ) -> Result<StripeEvent, StripeServiceError>;

    async fn retrieve_event(&self, event_id: &str) -> Result<StripeEvent, StripeServiceError>;

    async fn get_active_subscription_for_customer(
        &self,
        customer_id: &str,
    ) -> Result<Option<SubscriptionInfo>, StripeServiceError>;

    async fn set_subscription_cancel_at_period_end(
        &self,
        subscription_id: &str,
        cancel_at_period_end: bool,
    ) -> Result<SubscriptionInfo, StripeServiceError>;

    async fn cancel_subscription_immediately(
        &self,
        subscription_id: &str,
    ) -> Result<(), StripeServiceError>;
}

mod live;
mod mock;

#[allow(unused_imports)]
pub use live::LiveStripeService;
#[allow(unused_imports)]
pub use mock::MockStripeService;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_captures_checkout_request_and_returns_url() {
        let mock = MockStripeService::new();
        let req = CreateCheckoutSessionRequest {
            success_url: "https://example.test/success".into(),
            cancel_url: "https://example.test/cancel".into(),
            mode: CheckoutMode::Subscription,
            line_items: vec![CheckoutLineItem {
                price: "price_123".into(),
                quantity: 1,
            }],
            client_reference_id: Some("00000000-0000-0000-0000-000000000000".into()),
            customer: Some("cus_test_123".into()),
            metadata: Some(
                [
                    ("plan".to_string(), "workspace".to_string()),
                    ("workspace_name".to_string(), "Acme".to_string()),
                ]
                .into_iter()
                .collect(),
            ),
        };

        let session = mock.create_checkout_session(req.clone()).await.unwrap();
        assert!(session.id.starts_with("cs_test_"));
        assert_eq!(
            session.url.as_deref(),
            Some("https://example.test/checkout")
        );

        let captured = mock.last_create_requests.lock().unwrap();
        assert_eq!(captured.len(), 1);
        let first = &captured[0];
        assert_eq!(first.success_url, req.success_url);
        assert_eq!(first.cancel_url, req.cancel_url);
        assert_eq!(first.client_reference_id, req.client_reference_id);
        assert_eq!(first.customer, req.customer);
        assert_eq!(first.line_items.len(), 1);
        assert_eq!(first.line_items[0].price, "price_123");
        assert_eq!(first.line_items[0].quantity, 1);
    }

    #[test]
    fn live_verify_webhook_invalid_signature_maps_to_webhook_error() {
        // Create service with a known secret; pass an invalid signature header
        let live = LiveStripeService::new("sk_test_dummy", "whsec_test");
        let payload = br#"{ "id": "evt_123", "type": "checkout.session.completed" }"#;
        let result = live.verify_webhook(payload, "t=1,v1=invalidsignature");
        assert!(matches!(result, Err(StripeServiceError::Webhook(_))));
    }

    #[tokio::test]
    async fn live_checkout_invalid_customer_id_maps_to_other_error() {
        let live = LiveStripeService::new("sk_test_dummy", "whsec_test");
        let req = CreateCheckoutSessionRequest {
            success_url: "https://example.test/success".into(),
            cancel_url: "https://example.test/cancel".into(),
            mode: CheckoutMode::Subscription,
            line_items: vec![CheckoutLineItem {
                price: "price_123".into(),
                quantity: 1,
            }],
            client_reference_id: None,
            customer: Some("not_a_customer_id".into()),
            metadata: None,
        };

        let result = live.create_checkout_session(req).await;
        assert!(matches!(result, Err(StripeServiceError::Other(_))));
    }
}
