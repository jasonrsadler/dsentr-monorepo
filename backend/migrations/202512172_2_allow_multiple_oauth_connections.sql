-- Allow multiple OAuth connections per provider for a user by removing the composite uniqueness
-- and adding provider-aware indexes for common lookups.
ALTER TABLE user_oauth_tokens
  DROP CONSTRAINT IF EXISTS user_oauth_tokens_user_id_provider_key;

CREATE INDEX IF NOT EXISTS idx_user_oauth_tokens_user_provider
  ON user_oauth_tokens (user_id, provider);

CREATE INDEX IF NOT EXISTS idx_user_oauth_tokens_provider_workspace
  ON user_oauth_tokens (provider, workspace_id);

-- Rollback:
--   DROP INDEX IF EXISTS idx_user_oauth_tokens_provider_workspace;
--   DROP INDEX IF EXISTS idx_user_oauth_tokens_user_provider;
--   ALTER TABLE user_oauth_tokens
--     ADD CONSTRAINT user_oauth_tokens_user_id_provider_key UNIQUE (user_id, provider);
