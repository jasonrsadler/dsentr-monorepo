-- 202512231_1_backfill_slack_team_ids_and_dedupe.sql
--
-- Purpose
-- - Backfill slack_team_id for existing Slack workspace connections from existing row metadata.
-- - Deterministically collapse duplicates per (workspace_id, slack_team_id), logging each deletion.
-- - Leave personal tokens unchanged (this migration does not touch user_oauth_tokens).
--
-- Scope
-- - ONLY provider = 'slack' rows in workspace_connections.
--
-- Non-goals (explicit)
-- - No implicit promotions.
-- - No webhook fallbacks.
-- - No changes to engine/runtime auth selection logic.
--
-- Destructive note
-- - This migration deletes duplicate workspace_connections rows for Slack.
-- - Recovery requires a database backup from before this migration.
--
-- Rollback guidance is at the bottom of this file.

BEGIN;

-- -------------------------------------------------------------------
-- 0) Create persistent dedupe log table (no foreign keys, per request)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slack_workspace_connection_dedupe_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    slack_team_id TEXT NOT NULL,
    kept_workspace_connection_id UUID NOT NULL,
    deleted_workspace_connection_id UUID NOT NULL,
    kept_connection_id UUID,
    deleted_connection_id UUID,
    decision JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Two indexes for common review paths (no foreign keys).
CREATE INDEX IF NOT EXISTS idx_slack_ws_conn_dedupe_log_workspace_created_at
    ON slack_workspace_connection_dedupe_log (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_slack_ws_conn_dedupe_log_team_created_at
    ON slack_workspace_connection_dedupe_log (slack_team_id, created_at DESC);

-- -------------------------------------------------------------------
-- 1) Normalize existing slack_team_id values (trim) for Slack rows
-- -------------------------------------------------------------------
UPDATE workspace_connections
SET slack_team_id = NULLIF(trim(slack_team_id), '')
WHERE provider = 'slack'::oauth_connection_provider
  AND slack_team_id IS NOT NULL;

-- -------------------------------------------------------------------
-- 2) Preflight validation
-- -------------------------------------------------------------------

-- 2a) Validate existing non-null slack_team_id values are valid.
DO $$
DECLARE
    invalid_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO invalid_count
    FROM workspace_connections
    WHERE provider = 'slack'::oauth_connection_provider
      AND slack_team_id IS NOT NULL
      AND (slack_team_id !~ '^T[0-9A-Z]+$' OR length(slack_team_id) > 32);

    IF invalid_count > 0 THEN
        RAISE EXCEPTION
            'Found % Slack workspace_connections rows with invalid slack_team_id (regex ^T[0-9A-Z]+$ and length<=32 required)',
            invalid_count;
    END IF;
END $$;

-- 2b) Validate metadata team ids, when present, are valid.
DO $$
DECLARE
    invalid_metadata_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO invalid_metadata_count
    FROM workspace_connections
    WHERE provider = 'slack'::oauth_connection_provider
      AND NULLIF(trim(metadata->'slack'->>'team_id'), '') IS NOT NULL
      AND (
            trim(metadata->'slack'->>'team_id') !~ '^T[0-9A-Z]+$'
            OR length(trim(metadata->'slack'->>'team_id')) > 32
          );

    IF invalid_metadata_count > 0 THEN
        RAISE EXCEPTION
            'Found % Slack workspace_connections rows with invalid metadata slack.team_id (regex ^T[0-9A-Z]+$ and length<=32 required)',
            invalid_metadata_count;
    END IF;
END $$;

-- 2c) Conflicts between slack_team_id column and metadata slack.team_id are not allowed.
DO $$
DECLARE
    conflict_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO conflict_count
    FROM workspace_connections
    WHERE provider = 'slack'::oauth_connection_provider
      AND slack_team_id IS NOT NULL
      AND NULLIF(trim(metadata->'slack'->>'team_id'), '') IS NOT NULL
      AND slack_team_id IS DISTINCT FROM trim(metadata->'slack'->>'team_id');

    IF conflict_count > 0 THEN
        RAISE EXCEPTION
            'Found % Slack workspace_connections rows with conflicting team id (slack_team_id != metadata slack.team_id)',
            conflict_count;
    END IF;
END $$;

-- 2d) Every Slack row must have a candidate team id from either column or metadata.
DO $$
DECLARE
    missing_candidate_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO missing_candidate_count
    FROM workspace_connections
    WHERE provider = 'slack'::oauth_connection_provider
      AND COALESCE(
            NULLIF(trim(slack_team_id), ''),
            NULLIF(trim(metadata->'slack'->>'team_id'), '')
          ) IS NULL;

    IF missing_candidate_count > 0 THEN
        RAISE EXCEPTION
            'Found % Slack workspace_connections rows with no team id candidate (slack_team_id and metadata slack.team_id both missing/blank)',
            missing_candidate_count;
    END IF;
END $$;

-- -------------------------------------------------------------------
-- 3) Backfill slack_team_id for Slack rows (only where missing)
-- -------------------------------------------------------------------
UPDATE workspace_connections
SET slack_team_id = trim(metadata->'slack'->>'team_id')
WHERE provider = 'slack'::oauth_connection_provider
  AND (slack_team_id IS NULL OR NULLIF(trim(slack_team_id), '') IS NULL)
  AND NULLIF(trim(metadata->'slack'->>'team_id'), '') IS NOT NULL;

-- -------------------------------------------------------------------
-- 4) Post-backfill validation (non-null + valid format)
-- -------------------------------------------------------------------
DO $$
DECLARE
    null_count INTEGER;
    invalid_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_count
    FROM workspace_connections
    WHERE provider = 'slack'::oauth_connection_provider
      AND slack_team_id IS NULL;

    IF null_count > 0 THEN
        RAISE EXCEPTION
            'Post-backfill validation failed: % Slack workspace_connections rows still have NULL slack_team_id',
            null_count;
    END IF;

    SELECT COUNT(*) INTO invalid_count
    FROM workspace_connections
    WHERE provider = 'slack'::oauth_connection_provider
      AND (slack_team_id !~ '^T[0-9A-Z]+$' OR length(slack_team_id) > 32);

    IF invalid_count > 0 THEN
        RAISE EXCEPTION
            'Post-backfill validation failed: % Slack workspace_connections rows have invalid slack_team_id (regex ^T[0-9A-Z]+$ and length<=32 required)',
            invalid_count;
    END IF;
END $$;

-- -------------------------------------------------------------------
-- 5) Deterministic dedupe per (workspace_id, slack_team_id), Slack only
--    Winner ordering (exact):
--      (connection_id IS NOT NULL) DESC,
--      updated_at DESC,
--      created_at DESC,
--      id DESC
-- -------------------------------------------------------------------

-- Collect dedupe candidates into a temp table so we can:
-- - log exactly what we will delete
-- - delete and verify rowcounts match
CREATE TEMP TABLE slack_workspace_connection_dedupe_ids (
    deleted_id UUID PRIMARY KEY,
    kept_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    slack_team_id TEXT NOT NULL,
    kept_connection_id UUID,
    deleted_connection_id UUID,
    decision JSONB NOT NULL
) ON COMMIT DROP;

WITH ranked AS (
    SELECT
        id,
        workspace_id,
        slack_team_id,
        connection_id,
        updated_at,
        created_at,
        ROW_NUMBER() OVER (
            PARTITION BY workspace_id, slack_team_id
            ORDER BY
                (connection_id IS NOT NULL) DESC,
                updated_at DESC,
                created_at DESC,
                id DESC
        ) AS rn,
        FIRST_VALUE(id) OVER (
            PARTITION BY workspace_id, slack_team_id
            ORDER BY
                (connection_id IS NOT NULL) DESC,
                updated_at DESC,
                created_at DESC,
                id DESC
        ) AS kept_id,
        FIRST_VALUE(connection_id) OVER (
            PARTITION BY workspace_id, slack_team_id
            ORDER BY
                (connection_id IS NOT NULL) DESC,
                updated_at DESC,
                created_at DESC,
                id DESC
        ) AS kept_connection_id
    FROM workspace_connections
    WHERE provider = 'slack'::oauth_connection_provider
)
INSERT INTO slack_workspace_connection_dedupe_ids (
    deleted_id,
    kept_id,
    workspace_id,
    slack_team_id,
    kept_connection_id,
    deleted_connection_id,
    decision
)
SELECT
    id AS deleted_id,
    kept_id,
    workspace_id,
    slack_team_id,
    kept_connection_id,
    connection_id AS deleted_connection_id,
    jsonb_build_object(
        'reason', 'deterministic_dedupe_by_workspace_and_team',
        'winner_order', jsonb_build_array(
            '(connection_id IS NOT NULL) DESC',
            'updated_at DESC',
            'created_at DESC',
            'id DESC'
        ),
        'deleted_rank', rn
    ) AS decision
FROM ranked
WHERE rn > 1;

-- Log deletions (zero rows is fine).
INSERT INTO slack_workspace_connection_dedupe_log (
    workspace_id,
    slack_team_id,
    kept_workspace_connection_id,
    deleted_workspace_connection_id,
    kept_connection_id,
    deleted_connection_id,
    decision
)
SELECT
    workspace_id,
    slack_team_id,
    kept_id,
    deleted_id,
    kept_connection_id,
    deleted_connection_id,
    decision
FROM slack_workspace_connection_dedupe_ids;

-- Delete and verify rowcount matches what we logged.
DO $$
DECLARE
    expected_deletions INTEGER;
    actual_deletions INTEGER;
BEGIN
    SELECT COUNT(*) INTO expected_deletions
    FROM slack_workspace_connection_dedupe_ids;

    DELETE FROM workspace_connections
    WHERE provider = 'slack'::oauth_connection_provider
      AND id IN (SELECT deleted_id FROM slack_workspace_connection_dedupe_ids);

    GET DIAGNOSTICS actual_deletions = ROW_COUNT;

    IF actual_deletions <> expected_deletions THEN
        RAISE EXCEPTION
            'Dedupe delete count mismatch: expected %, deleted %',
            expected_deletions, actual_deletions;
    END IF;
END $$;

-- -------------------------------------------------------------------
-- 6) Final validation (non-null, valid, unique per workspace/team)
-- -------------------------------------------------------------------
DO $$
DECLARE
    null_count INTEGER;
    invalid_count INTEGER;
    duplicate_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_count
    FROM workspace_connections
    WHERE provider = 'slack'::oauth_connection_provider
      AND slack_team_id IS NULL;

    IF null_count > 0 THEN
        RAISE EXCEPTION
            'Final validation failed: % Slack workspace_connections rows have NULL slack_team_id',
            null_count;
    END IF;

    SELECT COUNT(*) INTO invalid_count
    FROM workspace_connections
    WHERE provider = 'slack'::oauth_connection_provider
      AND (slack_team_id !~ '^T[0-9A-Z]+$' OR length(slack_team_id) > 32);

    IF invalid_count > 0 THEN
        RAISE EXCEPTION
            'Final validation failed: % Slack workspace_connections rows have invalid slack_team_id',
            invalid_count;
    END IF;

    WITH d AS (
        SELECT workspace_id, slack_team_id, COUNT(*) AS cnt
        FROM workspace_connections
        WHERE provider = 'slack'::oauth_connection_provider
        GROUP BY workspace_id, slack_team_id
        HAVING COUNT(*) > 1
    )
    SELECT COUNT(*) INTO duplicate_count FROM d;

    IF duplicate_count > 0 THEN
        RAISE EXCEPTION
            'Final validation failed: % duplicate Slack workspace_connections groups remain by (workspace_id, slack_team_id)',
            duplicate_count;
    END IF;
END $$;

COMMIT;

-- -------------------------------------------------------------------
-- Validation steps to run manually after deploy (read-only)
-- -------------------------------------------------------------------
-- 1) Confirm no Slack rows missing team id
-- SELECT COUNT(*) FROM workspace_connections
-- WHERE provider = 'slack'::oauth_connection_provider AND slack_team_id IS NULL;
--
-- 2) Confirm no Slack duplicates remain
-- SELECT workspace_id, slack_team_id, COUNT(*)
-- FROM workspace_connections
-- WHERE provider = 'slack'::oauth_connection_provider
-- GROUP BY workspace_id, slack_team_id
-- HAVING COUNT(*) > 1;
--
-- 3) Review dedupe actions (if any)
-- SELECT *
-- FROM slack_workspace_connection_dedupe_log
-- ORDER BY created_at DESC
-- LIMIT 200;

-- -------------------------------------------------------------------
-- Rollback guidance (destructive migration)
-- -------------------------------------------------------------------
-- There is no safe automatic rollback, because rows may have been deleted.
-- If you must revert:
-- 1) Restore the database from a pre-migration backup, or
-- 2) Reinsert deleted rows manually using slack_workspace_connection_dedupe_log
--    as a guide (you will still need the full prior row contents from backup).
--
-- If you only need to remove the log table and its indexes (not recommended):
-- DROP INDEX IF EXISTS idx_slack_ws_conn_dedupe_log_team_created_at;
-- DROP INDEX IF EXISTS idx_slack_ws_conn_dedupe_log_workspace_created_at;
-- DROP TABLE IF EXISTS slack_workspace_connection_dedupe_log;
