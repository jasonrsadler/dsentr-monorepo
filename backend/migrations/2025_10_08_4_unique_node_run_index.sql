-- Ensure idempotent writes per node within a run
DO $$
BEGIN
  -- Create a unique index to back ON CONFLICT upserts
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uniq_node_runs_run_node'
  ) THEN
    CREATE UNIQUE INDEX uniq_node_runs_run_node ON workflow_node_runs (run_id, node_id);
  END IF;
END $$ LANGUAGE plpgsql;

