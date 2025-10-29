CREATE TABLE IF NOT EXISTS egress_block_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  rule TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_egress_blocks_wf_created
  ON egress_block_events (workflow_id, created_at DESC);

-- Rollback:
--   DROP INDEX IF EXISTS idx_egress_blocks_wf_created;
--   DROP TABLE IF EXISTS egress_block_events;

