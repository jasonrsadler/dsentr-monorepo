-- Normalize workspace ownership details, invitation status tracking, and audit history
ALTER TABLE workspaces
    ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'workspace',
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

UPDATE workspaces
SET owner_id = created_by
WHERE owner_id IS NULL;

ALTER TABLE workspaces
    ALTER COLUMN owner_id SET NOT NULL;

DROP INDEX IF EXISTS idx_workspace_invites_token;

ALTER TABLE workspace_invitations
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
    ADD CONSTRAINT workspace_invitations_status_check
        CHECK (status IN ('pending', 'accepted', 'revoked', 'declined')),
    ADD CONSTRAINT workspace_invitations_token_key UNIQUE (token);

UPDATE workspace_invitations
SET status = CASE
    WHEN accepted_at IS NOT NULL THEN 'accepted'
    WHEN revoked_at IS NOT NULL THEN 'revoked'
    WHEN ignored_at IS NOT NULL THEN 'declined'
    ELSE 'pending'
END;

DROP TABLE IF EXISTS workspace_member_audit;

CREATE TABLE workspace_member_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('invited', 'joined', 'role_updated', 'revoked', 'left')),
    reason TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
