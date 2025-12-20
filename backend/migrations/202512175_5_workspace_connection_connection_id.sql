ALTER TABLE workspace_connections
  ADD COLUMN connection_id UUID;

UPDATE workspace_connections
SET connection_id = user_oauth_token_id
WHERE connection_id IS NULL
  AND user_oauth_token_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_connections_workspace_connection_id
  ON workspace_connections (workspace_id, connection_id)
  WHERE connection_id IS NOT NULL;

-- Rollback:
--   DROP INDEX IF EXISTS idx_workspace_connections_workspace_connection_id;
--   ALTER TABLE workspace_connections DROP COLUMN IF EXISTS connection_id;
