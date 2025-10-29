ALTER TABLE workflows
    ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_workflows_locked_by ON workflows (locked_by);

-- Rollback:
--   DROP INDEX IF EXISTS idx_workflows_locked_by;
--   ALTER TABLE workflows
--     DROP COLUMN IF EXISTS locked_by,
--     DROP COLUMN IF EXISTS locked_at;
