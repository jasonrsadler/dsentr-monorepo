ALTER TABLE workflow_runs
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);

UPDATE workflow_runs wr
SET workspace_id = w.workspace_id
FROM workflows w
WHERE wr.workflow_id = w.id
  AND (wr.workspace_id IS DISTINCT FROM w.workspace_id);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workspace_id
  ON workflow_runs (workspace_id);

DROP INDEX IF EXISTS idx_workflow_runs_idem_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_idem_unique
  ON workflow_runs (COALESCE(workspace_id, user_id), workflow_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
