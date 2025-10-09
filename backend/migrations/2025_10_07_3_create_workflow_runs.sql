-- Create workflow_runs table to track executions
CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  -- Immutable snapshot of the workflow graph at run start (typically the workflow.data JSON)
  snapshot JSONB NOT NULL,
  -- queued | running | succeeded | failed | canceled
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','canceled')) DEFAULT 'queued',
  error TEXT,
  idempotency_key TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique idempotency per user+workflow when key provided
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_idem_unique
  ON workflow_runs (user_id, workflow_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_created
  ON workflow_runs (workflow_id, created_at DESC);

-- Reuse the generic updated_at trigger function (already created earlier)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_workflow_runs_updated_at'
  ) THEN
    CREATE TRIGGER update_workflow_runs_updated_at
    BEFORE UPDATE ON workflow_runs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$ LANGUAGE plpgsql;

