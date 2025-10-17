ALTER TABLE workflows
    ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_workflows_locked_by ON workflows (locked_by);
