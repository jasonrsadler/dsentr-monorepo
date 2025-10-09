CREATE TABLE IF NOT EXISTS workflow_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    config JSONB NOT NULL,
    next_run_at TIMESTAMPTZ,
    last_run_at TIMESTAMPTZ,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_schedules_workflow_id
    ON workflow_schedules(workflow_id);

CREATE INDEX IF NOT EXISTS idx_workflow_schedules_next_run
    ON workflow_schedules(next_run_at)
    WHERE enabled = true;

CREATE OR REPLACE FUNCTION set_workflow_schedules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_workflow_schedules_updated_at ON workflow_schedules;
CREATE TRIGGER set_workflow_schedules_updated_at
BEFORE UPDATE ON workflow_schedules
FOR EACH ROW
EXECUTE PROCEDURE set_workflow_schedules_updated_at();
