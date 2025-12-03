-- Track when a queued run becomes eligible for execution (used by Delay nodes and backoff scheduling)
ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS resume_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_workflow_runs_resume_at
  ON workflow_runs (resume_at);

-- Rollback:
--   DROP INDEX IF EXISTS idx_workflow_runs_resume_at;
--   ALTER TABLE workflow_runs DROP COLUMN IF EXISTS resume_at;
