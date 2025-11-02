-- Deprecate workspace team tables in favor of direct workspace membership
BEGIN;

CREATE TABLE IF NOT EXISTS team_removal_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    team_id UUID,
    resource_type TEXT NOT NULL,
    resource_id UUID,
    metadata JSONB,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Promote existing team members to direct workspace members
INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
SELECT t.workspace_id, tm.user_id, 'user'::workspace_role, tm.added_at
FROM team_members tm
JOIN teams t ON t.id = tm.team_id
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Log workflow shares that were previously granted via teams
INSERT INTO team_removal_audit (workspace_id, team_id, resource_type, resource_id, metadata)
SELECT t.workspace_id,
       s.team_id,
       'workflow_share',
       s.workflow_id,
       jsonb_build_object('logged_at', now())
FROM team_workflow_shares s
JOIN teams t ON t.id = s.team_id;

-- Log invitations that referenced teams prior to removal
INSERT INTO team_removal_audit (workspace_id, team_id, resource_type, resource_id, metadata)
SELECT workspace_id,
       team_id,
       'workspace_invitation',
       id,
       jsonb_build_object('token', token)
FROM workspace_invitations
WHERE team_id IS NOT NULL;

-- Log shareable invite links prior to removal
INSERT INTO team_removal_audit (workspace_id, team_id, resource_type, resource_id, metadata)
SELECT workspace_id,
       team_id,
       'team_invite_link',
       id,
       jsonb_build_object('token', token)
FROM team_invite_links;

-- Log the teams themselves for historical context
INSERT INTO team_removal_audit (workspace_id, team_id, resource_type, resource_id, metadata)
SELECT workspace_id,
       id,
       'team',
       id,
       jsonb_build_object('name', name)
FROM teams;

ALTER TABLE workspace_invitations
    DROP COLUMN IF EXISTS team_id;

DROP TABLE IF EXISTS team_invite_links;
DROP TABLE IF EXISTS team_workflow_shares;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;

COMMIT;

-- Rollback:
--   Recreate teams, team_members, team_workflow_shares, and team_invite_links using
--   migrations 2025_10_14_1_create_workspaces.sql and 2025_10_15_3_create_team_invite_links.sql,
--   add the team_id column back to workspace_invitations, reload historical data from
--   team_removal_audit or backups, and drop team_removal_audit once reconciliation is done.
