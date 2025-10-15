-- Workspace core tables and workspace-aware workflow scoping
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_role') THEN
        CREATE TYPE workspace_role AS ENUM ('admin', 'user', 'viewer');
    END IF;
END $$;

ALTER TABLE IF EXISTS users
    ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role workspace_role NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS team_workflow_shares (
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, workflow_id)
);

ALTER TABLE workflows
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);

ALTER TABLE workflow_logs
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);

ALTER TABLE workflow_runs
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);

ALTER TABLE workflow_node_runs
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);

ALTER TABLE workflow_dead_letters
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);

ALTER TABLE workflow_schedules
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);

ALTER TABLE webhook_replays
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);

ALTER TABLE egress_block_events
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);

DROP INDEX IF EXISTS idx_workflows_user_lower_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_owner_scope_lower_name_unique
    ON workflows (COALESCE(workspace_id, user_id), lower(name));

