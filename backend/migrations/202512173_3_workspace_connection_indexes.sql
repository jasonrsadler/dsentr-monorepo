-- Drop workspace connection uniqueness keyed by provider/owner/token to allow multiple shared
-- connections per provider and rely on connection ids plus dedicated lookup indexes instead.
DROP INDEX IF EXISTS workspace_connections_workspace_provider_owner_token_idx;

CREATE INDEX IF NOT EXISTS idx_workspace_connections_workspace_provider
  ON workspace_connections (workspace_id, provider);

CREATE INDEX IF NOT EXISTS idx_workspace_connections_owner_provider
  ON workspace_connections (owner_user_id, provider);

CREATE INDEX IF NOT EXISTS idx_workspace_connections_user_oauth_token
  ON workspace_connections (user_oauth_token_id);

-- Rollback:
--   DROP INDEX IF EXISTS idx_workspace_connections_user_oauth_token;
--   DROP INDEX IF EXISTS idx_workspace_connections_owner_provider;
--   DROP INDEX IF EXISTS idx_workspace_connections_workspace_provider;
--   CREATE UNIQUE INDEX IF NOT EXISTS workspace_connections_workspace_provider_owner_token_idx
--     ON workspace_connections (workspace_id, provider, owner_user_id, user_oauth_token_id);
--   -- Ensure duplicate rows are resolved before re-applying the unique index.
