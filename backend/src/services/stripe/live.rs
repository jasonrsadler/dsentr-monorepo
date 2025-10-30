#![allow(dead_code)]
use super::{
    CheckoutLineItem, CheckoutMode, CheckoutSession, CreateCheckoutSessionRequest, StripeEvent,
    StripeService, StripeServiceError,
};
use async_trait::async_trait;

pub struct LiveStripeService {
    client: stripe::Client,
    webhook_secret: String,
}

impl LiveStripeService {
    pub fn new(secret_key: impl Into<String>, webhook_secret: impl Into<String>) -> Self {
        let client = stripe::Client::new(secret_key);
        Self {
            client,
            webhook_secret: webhook_secret.into(),
        }
    }

    pub fn from_settings(settings: &crate::config::StripeSettings) -> Self {
        Self::new(settings.secret_key.clone(), settings.webhook_secret.clone())
    }
}

fn map_mode(mode: CheckoutMode) -> stripe::CheckoutSessionMode {
    match mode {
        CheckoutMode::Payment => stripe::CheckoutSessionMode::Payment,
        CheckoutMode::Subscription => stripe::CheckoutSessionMode::Subscription,
        CheckoutMode::Setup => stripe::CheckoutSessionMode::Setup,
    }
}

fn map_line_items(items: &[CheckoutLineItem]) -> Vec<stripe::CreateCheckoutSessionLineItems> {
    items
        .iter()
        .map(|li| stripe::CreateCheckoutSessionLineItems {
            price: Some(li.price.clone()),
            quantity: Some(li.quantity),
            ..Default::default()
        })
        .collect()
}

#[async_trait]
impl StripeService for LiveStripeService {
    async fn create_checkout_session(
        &self,
        req: CreateCheckoutSessionRequest,
    ) -> Result<CheckoutSession, StripeServiceError> {
        let mut params = stripe::CreateCheckoutSession::new();
        params.mode = Some(map_mode(req.mode));
        params.success_url = Some(&req.success_url);
        params.cancel_url = Some(&req.cancel_url);
        if let Some(ref id) = req.client_reference_id {
            params.client_reference_id = Some(id);
        }
        if let Some(ref customer) = req.customer {
            let cid = customer
                .parse::<stripe::CustomerId>()
                .map_err(|e| StripeServiceError::Other(e.to_string()))?;
            params.customer = Some(cid);
        }
        if let Some(ref meta) = req.metadata {
            let mut m = std::collections::HashMap::new();
            for (k, v) in meta.iter() {
                m.insert(k.clone(), v.clone());
            }
            params.metadata = Some(m);
        }
        if !req.line_items.is_empty() {
            let mapped = map_line_items(&req.line_items);
            params.line_items = Some(mapped);
        }

        let session = stripe::CheckoutSession::create(&self.client, params).await?;
        Ok(CheckoutSession {
            id: session.id.to_string(),
            url: session.url.clone(),
        })
    }

    async fn create_customer(
        &self,
        email: &str,
        name: Option<&str>,
    ) -> Result<String, StripeServiceError> {
        let mut params = stripe::CreateCustomer::new();
        params.email = Some(email);
        if let Some(name) = name {
            params.name = Some(name);
        }
        let customer = stripe::Customer::create(&self.client, params).await?;
        Ok(customer.id.to_string())
    }

    fn verify_webhook(
        &self,
        payload: &[u8],
        signature_header: &str,
    ) -> Result<StripeEvent, StripeServiceError> {
        let payload_str =
            std::str::from_utf8(payload).map_err(|e| StripeServiceError::Serde(e.to_string()))?;
        let event =
            stripe::Webhook::construct_event(payload_str, signature_header, &self.webhook_secret)?;
        let payload =
            serde_json::to_value(&event).map_err(|e| StripeServiceError::Serde(e.to_string()))?;
        Ok(StripeEvent {
            id: event.id.to_string(),
            r#type: event.type_.to_string(),
            payload,
        })
    }

    async fn retrieve_event(&self, event_id: &str) -> Result<StripeEvent, StripeServiceError> {
        let event_id = event_id
            .parse::<stripe::EventId>()
            .map_err(|e| StripeServiceError::Other(e.to_string()))?;
        let event = stripe::Event::retrieve(&self.client, &event_id, &[]).await?;
        let payload =
            serde_json::to_value(&event).map_err(|e| StripeServiceError::Serde(e.to_string()))?;
        Ok(StripeEvent {
            id: event.id.to_string(),
            r#type: event.type_.to_string(),
            payload,
        })
    }

    async fn get_active_subscription_for_customer(
        &self,
        customer_id: &str,
    ) -> Result<Option<crate::services::stripe::SubscriptionInfo>, StripeServiceError> {
        // Build list params filtered by customer and active-like statuses
        let cust_id = customer_id
            .parse::<stripe::CustomerId>()
            .map_err(|e| StripeServiceError::Other(e.to_string()))?;

        let mut list_params = stripe::ListSubscriptions::new();
        list_params.customer = Some(cust_id);
        // Keep it simple: Stripe will default to status='all'. We'll filter in code for active/trialing.
        list_params.limit = Some(10);

        let subs = stripe::Subscription::list(&self.client, &list_params).await?;
        for sub in subs.data.into_iter() {
            // Consider active or trialing subscriptions only
            let status = sub.status.to_string();
            let is_active_like = matches!(
                sub.status,
                stripe::SubscriptionStatus::Active | stripe::SubscriptionStatus::Trialing
            );
            if !is_active_like {
                continue;
            }

            let info = crate::services::stripe::SubscriptionInfo {
                id: sub.id.to_string(),
                status,
                current_period_end: sub.current_period_end,
                cancel_at: sub.cancel_at,
                cancel_at_period_end: sub.cancel_at_period_end,
            };
            return Ok(Some(info));
        }

        Ok(None)
    }

    async fn set_subscription_cancel_at_period_end(
        &self,
        subscription_id: &str,
        cancel_at_period_end: bool,
    ) -> Result<crate::services::stripe::SubscriptionInfo, StripeServiceError> {
        let sub_id = subscription_id
            .parse::<stripe::SubscriptionId>()
            .map_err(|e| StripeServiceError::Other(e.to_string()))?;
        let mut params = stripe::UpdateSubscription::new();
        params.cancel_at_period_end = Some(cancel_at_period_end);
        let sub = stripe::Subscription::update(&self.client, &sub_id, params).await?;
        Ok(crate::services::stripe::SubscriptionInfo {
            id: sub.id.to_string(),
            status: sub.status.to_string(),
            current_period_end: sub.current_period_end,
            cancel_at: sub.cancel_at,
            cancel_at_period_end: sub.cancel_at_period_end,
        })
    }

    async fn cancel_subscription_immediately(
        &self,
        subscription_id: &str,
    ) -> Result<(), StripeServiceError> {
        let sub_id = subscription_id
            .parse::<stripe::SubscriptionId>()
            .map_err(|e| StripeServiceError::Other(e.to_string()))?;
        stripe::Subscription::cancel(&self.client, &sub_id, Default::default()).await?;
        Ok(())
    }
}
