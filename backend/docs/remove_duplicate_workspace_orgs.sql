-- Cleanup script to collapse duplicate organizations and workspaces created by the
-- subscription plan change bug that previously created a new organization/workspace
-- on each change. The script rewires foreign key references to a single canonical
-- record per (created_by, lower(name)) pair and deletes the redundant rows.
--
-- Run this inside a transaction and verify the affected row counts in each step
-- before committing.
--
-- ⚠️ Validation & rollback workflow
--   1. Run the script within an explicit transaction (e.g. `BEGIN; \i remove_duplicate_workspace_orgs.sql;`).
--   2. Review the persisted audit rows before issuing `COMMIT;` using:
--        SELECT *
--        FROM public.workspace_entity_dedup_audit
--        WHERE run_id = (SELECT run_id FROM tmp_dedup_run);
--   3. Export the audit rows if desired (e.g. `\copy (...) TO 'dedup_audit.csv' WITH CSV HEADER`).
--   4. If anything looks incorrect, execute `ROLLBACK;` to revert all changes.
--   5. Only execute `COMMIT;` after verifying the audit data and the summary metrics
--      printed at the bottom of this script.
BEGIN;

-- Capture the transaction-scoped identifier, executor, and baseline counts so we can
-- persist audit data and compare pre/post metrics before committing the changes.
CREATE TEMP TABLE tmp_dedup_run ON COMMIT DROP AS
SELECT
    txid_current()     AS run_id,
    clock_timestamp()  AS captured_at,
    current_user       AS executed_by;

CREATE TEMP TABLE tmp_pre_run_metrics ON COMMIT DROP AS
SELECT *
FROM (
    SELECT 'organizations_total' AS metric, COUNT(*)::bigint AS total_count FROM organizations
    UNION ALL
    SELECT 'workspaces_total' AS metric, COUNT(*)::bigint FROM workspaces
    UNION ALL
    SELECT 'organization_duplicate_groups' AS metric, COUNT(*)::bigint
    FROM (
        SELECT created_by, LOWER(name) AS normalized_name
        FROM organizations
        GROUP BY created_by, LOWER(name)
        HAVING COUNT(*) > 1
    ) dup_orgs
    UNION ALL
    SELECT 'workspace_duplicate_groups' AS metric, COUNT(*)::bigint
    FROM (
        SELECT created_by, LOWER(name) AS normalized_name
        FROM workspaces
        GROUP BY created_by, LOWER(name)
        HAVING COUNT(*) > 1
    ) dup_workspaces
) metrics;

-- Ensure the persistent audit table exists before we capture duplicate/canonical
-- mappings. The audit rows let us validate the rewiring, export the data for
-- cross-checking, and revert safely if needed.
CREATE TABLE IF NOT EXISTS public.workspace_entity_dedup_audit (
    run_id        bigint      NOT NULL,
    captured_at   timestamptz NOT NULL,
    executed_by   text        NOT NULL,
    entity_type   text        NOT NULL CHECK (entity_type IN ('organization', 'workspace')),
    duplicate_id  uuid        NOT NULL,
    canonical_id  uuid        NOT NULL,
    notes         text        NULL,
    PRIMARY KEY (run_id, entity_type, duplicate_id)
);

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

-- Persist the organization duplicate/canonical pairs before we mutate any data so
-- they are reviewable even if later validation fails.
INSERT INTO public.workspace_entity_dedup_audit (
    run_id,
    captured_at,
    executed_by,
    entity_type,
    duplicate_id,
    canonical_id,
    notes
)
SELECT
    r.run_id,
    r.captured_at,
    r.executed_by,
    'organization' AS entity_type,
    m.duplicate_id,
    m.canonical_id,
    'remove_duplicate_workspace_orgs.sql' AS notes
FROM tmp_dedup_run r
JOIN tmp_org_mapping m ON TRUE;

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

-- Persist the workspace duplicate/canonical pairs before we mutate workspace
-- level data. Reviewing these rows alongside the organization audit entries
-- provides a complete view of the rewiring performed in this transaction.
INSERT INTO public.workspace_entity_dedup_audit (
    run_id,
    captured_at,
    executed_by,
    entity_type,
    duplicate_id,
    canonical_id,
    notes
)
SELECT
    r.run_id,
    r.captured_at,
    r.executed_by,
    'workspace' AS entity_type,
    m.duplicate_id,
    m.canonical_id,
    'remove_duplicate_workspace_orgs.sql' AS notes
FROM tmp_dedup_run r
JOIN tmp_workspace_mapping m ON TRUE;

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

-- Capture post-change metrics so we can compare them to the baseline snapshot
-- captured at the beginning of the run. Expect duplicate group counts to drop
-- to zero while total counts decrease only by the number of redundant rows.
CREATE TEMP TABLE tmp_post_run_metrics ON COMMIT DROP AS
SELECT *
FROM (
    SELECT 'organizations_total' AS metric, COUNT(*)::bigint AS total_count FROM organizations
    UNION ALL
    SELECT 'workspaces_total' AS metric, COUNT(*)::bigint FROM workspaces
    UNION ALL
    SELECT 'organization_duplicate_groups' AS metric, COUNT(*)::bigint
    FROM (
        SELECT created_by, LOWER(name) AS normalized_name
        FROM organizations
        GROUP BY created_by, LOWER(name)
        HAVING COUNT(*) > 1
    ) dup_orgs
    UNION ALL
    SELECT 'workspace_duplicate_groups' AS metric, COUNT(*)::bigint
    FROM (
        SELECT created_by, LOWER(name) AS normalized_name
        FROM workspaces
        GROUP BY created_by, LOWER(name)
        HAVING COUNT(*) > 1
    ) dup_workspaces
) metrics;

-- Summarized verification to review before committing. Duplicate group metrics
-- should be 0 after the fix, and total entity counts should only decline by the
-- number of duplicates removed. Investigate any unexpected deltas before COMMIT.
SELECT
    pre.metric,
    pre.total_count AS pre_count,
    post.total_count AS post_count,
    (pre.total_count - post.total_count) AS delta
FROM tmp_pre_run_metrics pre
LEFT JOIN tmp_post_run_metrics post USING (metric)
ORDER BY pre.metric;

COMMIT;
