use crate::db::stripe_event_log_repository::StripeEventLogRepository;
use async_trait::async_trait;
use sqlx::{Postgres, Transaction};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct MockStripeEventLogRepository {
    events: Arc<Mutex<HashSet<String>>>,
    pub checks: Arc<Mutex<usize>>,
    pub inserts: Arc<Mutex<usize>>,
}

impl MockStripeEventLogRepository {
    #[allow(dead_code)]
    pub fn recorded_events(&self) -> Vec<String> {
        self.events.lock().unwrap().iter().cloned().collect()
    }
}

#[async_trait]
impl StripeEventLogRepository for MockStripeEventLogRepository {
    async fn has_processed_event(
        &self,
        event_id: &str,
        _tx: &mut Transaction<'_, Postgres>,
    ) -> Result<bool, sqlx::Error> {
        let mut guard = self.checks.lock().unwrap();
        *guard += 1;
        Ok(self.events.lock().unwrap().contains(event_id))
    }

    async fn record_event(
        &self,
        event_id: &str,
        _tx: &mut Transaction<'_, Postgres>,
    ) -> Result<(), sqlx::Error> {
        let mut guard = self.inserts.lock().unwrap();
        *guard += 1;
        self.events.lock().unwrap().insert(event_id.to_string());
        Ok(())
    }
}
