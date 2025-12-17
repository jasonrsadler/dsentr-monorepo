-- Persist provider metadata (encrypted) alongside personal OAuth tokens
ALTER TABLE user_oauth_tokens
ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Rollback:
--   ALTER TABLE user_oauth_tokens DROP COLUMN IF EXISTS metadata;
