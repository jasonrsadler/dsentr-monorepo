-- Allow multiple OAuth connections per provider by removing provider-level uniqueness
-- and scoping updates by connection id instead.
ALTER TABLE user_oauth_tokens
  DROP CONSTRAINT IF EXISTS user_oauth_tokens_user_id_provider_key;

CREATE INDEX IF NOT EXISTS idx_user_oauth_tokens_user_provider
  ON user_oauth_tokens (user_id, provider);

-- Workspace connections already reference user_oauth_token_id, so drop the
-- composite uniqueness that previously restricted multiple connections per provider
-- for the same owner/token pairing.
DROP INDEX IF EXISTS workspace_connections_workspace_provider_owner_token_idx;

CREATE INDEX IF NOT EXISTS idx_workspace_connections_owner_provider_token
  ON workspace_connections (owner_user_id, provider, user_oauth_token_id);

-- Rollback:
--   DROP INDEX IF EXISTS idx_workspace_connections_owner_provider_token;
--   CREATE UNIQUE INDEX IF NOT EXISTS workspace_connections_workspace_provider_owner_token_idx
--     ON workspace_connections (workspace_id, provider, owner_user_id, user_oauth_token_id);
--   DROP INDEX IF EXISTS idx_user_oauth_tokens_user_provider;
--   ALTER TABLE user_oauth_tokens
--     ADD CONSTRAINT user_oauth_tokens_user_id_provider_key UNIQUE (user_id, provider);
