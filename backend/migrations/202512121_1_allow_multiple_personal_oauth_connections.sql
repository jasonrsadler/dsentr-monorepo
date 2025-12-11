-- Allow multiple personal OAuth connections per provider by removing the prior uniqueness constraint.
ALTER TABLE user_oauth_tokens
  DROP CONSTRAINT IF EXISTS user_oauth_tokens_user_id_provider_key;

-- Index to keep provider lookups performant when selecting the most recent token per provider.
CREATE INDEX IF NOT EXISTS idx_user_oauth_tokens_user_provider_updated
  ON user_oauth_tokens (user_id, provider, updated_at DESC);

-- Rollback:
--   DROP INDEX IF EXISTS idx_user_oauth_tokens_user_provider_updated;
--   ALTER TABLE user_oauth_tokens
--     ADD CONSTRAINT user_oauth_tokens_user_id_provider_key UNIQUE (user_id, provider);
