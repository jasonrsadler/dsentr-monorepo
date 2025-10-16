-- Track workspace membership changes for compliance and notifications
CREATE TABLE IF NOT EXISTS workspace_member_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    acted_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
