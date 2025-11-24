-- Track Stripe metered overage subscription item on workspaces
ALTER TABLE workspaces
    ADD COLUMN IF NOT EXISTS stripe_overage_item_id TEXT;

-- Rollback:
--   ALTER TABLE workspaces DROP COLUMN IF EXISTS stripe_overage_item_id;
