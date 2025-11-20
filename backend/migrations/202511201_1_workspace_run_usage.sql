CREATE TABLE workspace_run_usage (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    period_start TIMESTAMPTZ NOT NULL,
    run_count BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, period_start)
);

CREATE INDEX idx_workspace_run_usage_period
    ON workspace_run_usage (period_start);

-- Rollback:
--   DROP INDEX IF EXISTS idx_workspace_run_usage_period;
--   DROP TABLE IF EXISTS workspace_run_usage;
