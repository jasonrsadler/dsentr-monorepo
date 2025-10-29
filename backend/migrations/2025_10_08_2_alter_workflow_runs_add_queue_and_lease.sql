-- Queue priority and leasing/heartbeat fields
ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS queue_priority INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leased_by TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt INT NOT NULL DEFAULT 0;

-- Composite index for frequent list queries
CREATE INDEX IF NOT EXISTS idx_workflow_runs_wf_status_created
  ON workflow_runs (workflow_id, status, created_at DESC);

-- Rollback:
--   DROP INDEX IF EXISTS idx_workflow_runs_wf_status_created;
--   ALTER TABLE workflow_runs
--     DROP COLUMN IF EXISTS queue_priority,
--     DROP COLUMN IF EXISTS leased_by,
--     DROP COLUMN IF EXISTS lease_expires_at,
--     DROP COLUMN IF EXISTS heartbeat_at,
--     DROP COLUMN IF EXISTS attempt;

