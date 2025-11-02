-- Invitations to join a workspace (optionally a specific team)

CREATE TABLE IF NOT EXISTS workspace_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    role workspace_role NOT NULL DEFAULT 'user',
    token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

-- A workspace cannot have multiple active invites for the same email
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invites_unique
ON workspace_invitations (workspace_id, lower(email))
WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_invites_token
ON workspace_invitations (token);

-- Rollback:
--   DROP INDEX IF EXISTS idx_workspace_invites_token;
--   DROP INDEX IF EXISTS idx_workspace_invites_unique;
--   DROP TABLE IF EXISTS workspace_invitations;

