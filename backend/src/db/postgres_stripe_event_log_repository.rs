use async_trait::async_trait;
use sqlx::{PgConnection, Postgres, Transaction};

use crate::db::stripe_event_log_repository::StripeEventLogRepository;

pub struct PostgresStripeEventLogRepository {}

#[async_trait]
impl StripeEventLogRepository for PostgresStripeEventLogRepository {
    fn supports_transactions(&self) -> bool {
        true
    }

    async fn has_processed_event(
        &self,
        event_id: &str,
        tx: Option<&mut Transaction<'_, Postgres>>,
    ) -> Result<bool, sqlx::Error> {
        let tx = tx.ok_or_else(|| {
            sqlx::Error::Protocol("transaction required for stripe event log".into())
        })?;

        let conn: &mut PgConnection = &mut *tx;
        let exists = sqlx::query_scalar::<Postgres, i64>(
            "SELECT 1 FROM stripe_event_log WHERE event_id = $1",
        )
        .bind(event_id)
        .fetch_optional(conn)
        .await?
        .is_some();

        Ok(exists)
    }

    async fn record_event(
        &self,
        event_id: &str,
        tx: Option<&mut Transaction<'_, Postgres>>,
    ) -> Result<(), sqlx::Error> {
        let tx = tx.ok_or_else(|| {
            sqlx::Error::Protocol("transaction required for stripe event log".into())
        })?;

        let conn: &mut PgConnection = &mut *tx;
        sqlx::query::<Postgres>(
            r#"
            INSERT INTO stripe_event_log (event_id, processed_at)
            VALUES ($1, NOW())
            ON CONFLICT (event_id) DO NOTHING
            "#,
        )
        .bind(event_id)
        .execute(conn)
        .await?;

        Ok(())
    }
}
