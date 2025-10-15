-- Cleanup script to collapse duplicate organizations and workspaces created by the
-- subscription plan change bug that previously created a new organization/workspace
-- on each change. The script rewires foreign key references to a single canonical
-- record per (created_by, lower(name)) pair and deletes the redundant rows.
--
-- Run this inside a transaction and verify the affected row counts in each step
-- before committing.
BEGIN;

-- Identify duplicate organizations and map them to the canonical record
CREATE TEMP TABLE tmp_org_mapping ON COMMIT DROP AS
WITH ranked AS (
    SELECT
        id,
        created_by,
        LOWER(name) AS normalized_name,
        created_at,
        FIRST_VALUE(id) OVER (
            PARTITION BY created_by, LOWER(name)
            ORDER BY created_at ASC, id ASC
        ) AS canonical_id
    FROM organizations
)
SELECT
    id AS duplicate_id,
    canonical_id
FROM ranked
WHERE id <> canonical_id;

-- Drop memberships that would conflict once moved to the canonical organization
DELETE FROM organization_members om
USING tmp_org_mapping m
WHERE om.organization_id = m.duplicate_id
  AND EXISTS (
      SELECT 1
      FROM organization_members existing
      WHERE existing.organization_id = m.canonical_id
        AND existing.user_id = om.user_id
  );

-- Re-home remaining organization memberships
UPDATE organization_members om
SET organization_id = m.canonical_id
FROM tmp_org_mapping m
WHERE om.organization_id = m.duplicate_id;

-- Point workspaces at the canonical organization
UPDATE workspaces w
SET organization_id = m.canonical_id
FROM tmp_org_mapping m
WHERE w.organization_id = m.duplicate_id;

-- Remove redundant organizations
DELETE FROM organizations o
USING tmp_org_mapping m
WHERE o.id = m.duplicate_id;

-- Identify duplicate workspaces and map them to their canonical instance
CREATE TEMP TABLE tmp_workspace_mapping ON COMMIT DROP AS
WITH ranked AS (
    SELECT
        id,
        created_by,
        LOWER(name) AS normalized_name,
        created_at,
        FIRST_VALUE(id) OVER (
            PARTITION BY created_by, LOWER(name)
            ORDER BY created_at ASC, id ASC
        ) AS canonical_id
    FROM workspaces
)
SELECT
    id AS duplicate_id,
    canonical_id
FROM ranked
WHERE id <> canonical_id;

-- Drop workspace memberships that would conflict after the reassignment
DELETE FROM workspace_members wm
USING tmp_workspace_mapping m
WHERE wm.workspace_id = m.duplicate_id
  AND EXISTS (
      SELECT 1
      FROM workspace_members existing
      WHERE existing.workspace_id = m.canonical_id
        AND existing.user_id = wm.user_id
  );

-- Move remaining workspace memberships
UPDATE workspace_members wm
SET workspace_id = m.canonical_id
FROM tmp_workspace_mapping m
WHERE wm.workspace_id = m.duplicate_id;

-- Teams cascade their team_members, so re-home teams themselves
UPDATE teams t
SET workspace_id = m.canonical_id
FROM tmp_workspace_mapping m
WHERE t.workspace_id = m.duplicate_id;

-- Re-home workflow artifacts that reference the duplicate workspaces
UPDATE workflows wf
SET workspace_id = m.canonical_id
FROM tmp_workspace_mapping m
WHERE wf.workspace_id = m.duplicate_id;

UPDATE workflow_logs wl
SET workspace_id = m.canonical_id
FROM tmp_workspace_mapping m
WHERE wl.workspace_id = m.duplicate_id;

UPDATE workflow_runs wr
SET workspace_id = m.canonical_id
FROM tmp_workspace_mapping m
WHERE wr.workspace_id = m.duplicate_id;

UPDATE workflow_node_runs wnr
SET workspace_id = m.canonical_id
FROM tmp_workspace_mapping m
WHERE wnr.workspace_id = m.duplicate_id;

UPDATE workflow_dead_letters wdl
SET workspace_id = m.canonical_id
FROM tmp_workspace_mapping m
WHERE wdl.workspace_id = m.duplicate_id;

UPDATE workflow_schedules ws
SET workspace_id = m.canonical_id
FROM tmp_workspace_mapping m
WHERE ws.workspace_id = m.duplicate_id;

UPDATE webhook_replays wr
SET workspace_id = m.canonical_id
FROM tmp_workspace_mapping m
WHERE wr.workspace_id = m.duplicate_id;

UPDATE egress_block_events ebe
SET workspace_id = m.canonical_id
FROM tmp_workspace_mapping m
WHERE ebe.workspace_id = m.duplicate_id;

-- Remove redundant workspaces now that every reference has been rewired
DELETE FROM workspaces w
USING tmp_workspace_mapping m
WHERE w.id = m.duplicate_id;

COMMIT;
