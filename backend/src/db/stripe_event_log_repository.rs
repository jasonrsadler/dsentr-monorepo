use async_trait::async_trait;
use sqlx::{Postgres, Transaction};

#[async_trait]
pub trait StripeEventLogRepository: Send + Sync {
    async fn has_processed_event(
        &self,
        event_id: &str,
        tx: &mut Transaction<'_, Postgres>,
    ) -> Result<bool, sqlx::Error>;

    async fn record_event(
        &self,
        event_id: &str,
        tx: &mut Transaction<'_, Postgres>,
    ) -> Result<(), sqlx::Error>;
}
