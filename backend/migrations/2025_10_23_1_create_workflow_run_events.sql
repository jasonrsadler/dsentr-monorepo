CREATE TABLE IF NOT EXISTS workflow_run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id),
  triggered_by TEXT NOT NULL,
  connection_type TEXT,
  connection_id UUID REFERENCES workspace_connections(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_run_events_run_recorded
  ON workflow_run_events (workflow_run_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_run_events_workflow_recorded
  ON workflow_run_events (workflow_id, recorded_at DESC);

