use async_trait::async_trait;
use sqlx::{Postgres, Transaction};

#[async_trait]
pub trait StripeEventLogRepository: Send + Sync {
    /// Whether this repo expects a real database transaction.
    fn supports_transactions(&self) -> bool {
        true
    }

    async fn has_processed_event(
        &self,
        event_id: &str,
        tx: Option<&mut Transaction<'_, Postgres>>,
    ) -> Result<bool, sqlx::Error>;

    async fn record_event(
        &self,
        event_id: &str,
        tx: Option<&mut Transaction<'_, Postgres>>,
    ) -> Result<(), sqlx::Error>;
}
