-- Allow workspace connections to survive personal token deletion by nulling the
-- token reference instead of cascading deletes.
ALTER TABLE workspace_connections
  DROP CONSTRAINT IF EXISTS workspace_connections_user_oauth_token_id_fkey;

ALTER TABLE workspace_connections
  ALTER COLUMN user_oauth_token_id DROP NOT NULL;

ALTER TABLE workspace_connections
  ADD CONSTRAINT workspace_connections_user_oauth_token_id_fkey
    FOREIGN KEY (user_oauth_token_id)
    REFERENCES user_oauth_tokens(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_connections_user_oauth_token
  ON workspace_connections (user_oauth_token_id);

-- Rollback:
--   ALTER TABLE workspace_connections
--     DROP CONSTRAINT IF EXISTS workspace_connections_user_oauth_token_id_fkey;
--   ALTER TABLE workspace_connections
--     ALTER COLUMN user_oauth_token_id SET NOT NULL;
--   ALTER TABLE workspace_connections
--     ADD CONSTRAINT workspace_connections_user_oauth_token_id_fkey
--       FOREIGN KEY (user_oauth_token_id)
--       REFERENCES user_oauth_tokens(id)
--       ON DELETE CASCADE;
--   -- Ensure rows with NULL user_oauth_token_id are cleaned up before reapplying NOT NULL.
