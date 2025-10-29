-- Track ignored workspace invitations and update uniqueness constraints
ALTER TABLE workspace_invitations
    ADD COLUMN IF NOT EXISTS ignored_at TIMESTAMPTZ;

-- Ensure unique active invites exclude ignored entries
DROP INDEX IF EXISTS idx_workspace_invites_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invites_unique
ON workspace_invitations (workspace_id, lower(email))
WHERE accepted_at IS NULL AND revoked_at IS NULL AND ignored_at IS NULL;

-- Rollback:
--   DROP INDEX IF EXISTS idx_workspace_invites_unique;
--   ALTER TABLE workspace_invitations DROP COLUMN IF EXISTS ignored_at;
--   CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invites_unique
--     ON workspace_invitations (workspace_id, lower(email))
--     WHERE accepted_at IS NULL AND revoked_at IS NULL;
