-- Create workflow_node_runs to record per-node execution during a run
CREATE TABLE IF NOT EXISTS workflow_node_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  name TEXT,
  node_type TEXT,
  inputs JSONB,
  outputs JSONB,
  -- queued | running | succeeded | failed | skipped | canceled
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','skipped','canceled')) DEFAULT 'queued',
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_node_runs_run_started
  ON workflow_node_runs (run_id, started_at ASC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_workflow_node_runs_updated_at'
  ) THEN
    CREATE TRIGGER update_workflow_node_runs_updated_at
    BEFORE UPDATE ON workflow_node_runs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$ LANGUAGE plpgsql;

