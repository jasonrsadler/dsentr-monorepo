-- Track processed Stripe webhook events for idempotency
CREATE TABLE IF NOT EXISTS stripe_event_log (
    event_id TEXT PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rollback:
--   DROP TABLE IF EXISTS stripe_event_log;
