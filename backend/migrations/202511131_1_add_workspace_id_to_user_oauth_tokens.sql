-- Add nullable workspace_id to user_oauth_tokens to distinguish personal vs workspace-bound tokens
ALTER TABLE user_oauth_tokens
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);

-- Optional index to aid future lookups by workspace context
CREATE INDEX IF NOT EXISTS idx_user_oauth_tokens_workspace_id
  ON user_oauth_tokens (workspace_id);

-- Rollback:
--   DROP INDEX IF EXISTS idx_user_oauth_tokens_workspace_id;
--   ALTER TABLE user_oauth_tokens DROP COLUMN IF EXISTS workspace_id;

