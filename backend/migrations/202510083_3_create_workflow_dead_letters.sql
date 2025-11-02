-- Dead-letter table captures terminal errors for requeue later
CREATE TABLE IF NOT EXISTS workflow_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  error TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dead_letters_wf_created
  ON workflow_dead_letters (workflow_id, created_at DESC);

-- Rollback:
--   DROP INDEX IF EXISTS idx_dead_letters_wf_created;
--   DROP TABLE IF EXISTS workflow_dead_letters;

