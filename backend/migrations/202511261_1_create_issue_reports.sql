-- Capture user-submitted issue reports for support follow-up
CREATE TABLE IF NOT EXISTS issue_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    user_email TEXT NOT NULL,
    user_name TEXT NOT NULL,
    user_plan TEXT,
    user_role TEXT,
    workspace_plan TEXT,
    workspace_role TEXT,
    description TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_reports_user_created_idx
    ON issue_reports (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS issue_reports_workspace_idx
    ON issue_reports (workspace_id, created_at DESC);

-- Rollback:
--   DROP TABLE IF EXISTS issue_reports;
