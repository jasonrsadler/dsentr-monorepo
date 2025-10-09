-- Creates workflow_logs table to persist per-save diffs
CREATE TABLE IF NOT EXISTS workflow_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  diffs JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_logs_workflow_created_at
  ON workflow_logs (workflow_id, created_at DESC);

