use crate::db::stripe_event_log_repository::StripeEventLogRepository;
use async_trait::async_trait;
use sqlx::{PgConnection, PgPool, Postgres, Transaction};

pub struct PostgresStripeEventLogRepository {
    pub pool: PgPool,
}

#[async_trait]
impl StripeEventLogRepository for PostgresStripeEventLogRepository {
    async fn has_processed_event(
        &self,
        event_id: &str,
        tx: &mut Transaction<'_, Postgres>,
    ) -> Result<bool, sqlx::Error> {
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
        tx: &mut Transaction<'_, Postgres>,
    ) -> Result<(), sqlx::Error> {
        let conn: &mut PgConnection = &mut *tx;
        sqlx::query::<Postgres>(
            r#"
            INSERT INTO stripe_event_log (event_id)
            VALUES ($1)
            ON CONFLICT (event_id) DO NOTHING
            "#,
        )
        .bind(event_id)
        .execute(conn)
        .await?;

        Ok(())
    }
}
