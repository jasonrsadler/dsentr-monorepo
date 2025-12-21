-- Enforce Slack workspace connection team identity invariants.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM workspace_connections
    WHERE provider = 'slack'::oauth_connection_provider
      AND slack_team_id IS NULL
  ) THEN
    RAISE EXCEPTION 'workspace_connections.slack_team_id must be set for Slack connections';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM workspace_connections
    WHERE provider = 'slack'::oauth_connection_provider
      AND slack_team_id IS NOT NULL
      AND length(slack_team_id) > 32
  ) THEN
    RAISE EXCEPTION 'Slack team ids must be stored in plaintext to enforce uniqueness';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM workspace_connections
    WHERE provider = 'slack'::oauth_connection_provider
    GROUP BY workspace_id, slack_team_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate Slack workspace connections detected; resolve duplicates before applying uniqueness constraint';
  END IF;
END $$;

ALTER TABLE workspace_connections
  ADD CONSTRAINT workspace_connections_slack_team_id_not_null
  CHECK (provider <> 'slack'::oauth_connection_provider OR slack_team_id IS NOT NULL);

ALTER TABLE workspace_connections
  ADD CONSTRAINT workspace_connections_slack_team_id_length
  CHECK (provider <> 'slack'::oauth_connection_provider OR length(slack_team_id) <= 32);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_connections_workspace_slack_team
  ON workspace_connections (workspace_id, slack_team_id)
  WHERE provider = 'slack'::oauth_connection_provider;

-- Rollback:
--   DROP INDEX IF EXISTS idx_workspace_connections_workspace_slack_team;
--   ALTER TABLE workspace_connections
--     DROP CONSTRAINT IF EXISTS workspace_connections_slack_team_id_not_null;
--   ALTER TABLE workspace_connections
--     DROP CONSTRAINT IF EXISTS workspace_connections_slack_team_id_length;
