CREATE TABLE workspace_billing_cycles (
    workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    stripe_subscription_id TEXT NOT NULL,
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workspace_billing_cycles_subscription
    ON workspace_billing_cycles (stripe_subscription_id);

-- Rollback:
--   DROP INDEX IF EXISTS idx_workspace_billing_cycles_subscription;
--   DROP TABLE IF EXISTS workspace_billing_cycles;
