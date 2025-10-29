-- Track used webhook signatures to prevent replay (within window)
CREATE TABLE IF NOT EXISTS webhook_replays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, signature)
);

CREATE INDEX IF NOT EXISTS idx_webhook_replays_created
  ON webhook_replays (created_at DESC);

-- Rollback:
--   DROP INDEX IF EXISTS idx_webhook_replays_created;
--   DROP TABLE IF EXISTS webhook_replays;

