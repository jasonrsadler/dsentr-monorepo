-- Add ownership metadata to workspace_connections so each record links back to
-- the promoting user and their source personal OAuth token.
ALTER TABLE workspace_connections
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_oauth_token_id UUID REFERENCES user_oauth_tokens(id) ON DELETE CASCADE;

-- Backfill ownership data using the existing created_by column.
UPDATE workspace_connections
SET owner_user_id = created_by
WHERE owner_user_id IS NULL;

-- Match each workspace connection with the newest personal OAuth token owned by
-- the creator for the same provider so we can backfill the foreign key.
WITH latest_personal_tokens AS (
  SELECT DISTINCT ON (user_id, provider)
    id,
    user_id,
    provider
  FROM user_oauth_tokens
  WHERE workspace_id IS NULL
  ORDER BY user_id, provider, updated_at DESC
)
UPDATE workspace_connections AS wc
SET user_oauth_token_id = lpt.id
FROM latest_personal_tokens lpt
WHERE lpt.user_id = wc.created_by
  AND lpt.provider = wc.provider
  AND wc.user_oauth_token_id IS NULL;

-- Ensure the new columns are always present for future rows.
ALTER TABLE workspace_connections
  ALTER COLUMN owner_user_id SET NOT NULL,
  ALTER COLUMN user_oauth_token_id SET NOT NULL;

-- Drop the previous uniqueness constraint which prevented workspaces from
-- promoting multiple connections per provider.
ALTER TABLE workspace_connections
  DROP CONSTRAINT IF EXISTS workspace_connections_workspace_id_provider_key;

-- Replace it with a stricter uniqueness definition that scopes by owner and
-- the corresponding OAuth token identifier.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_connections_workspace_provider_owner_token_idx
  ON workspace_connections (workspace_id, provider, owner_user_id, user_oauth_token_id);

-- Rollback:
--   DROP INDEX IF EXISTS workspace_connections_workspace_provider_owner_token_idx;
--   ALTER TABLE workspace_connections
--     ADD CONSTRAINT workspace_connections_workspace_id_provider_key UNIQUE (workspace_id, provider);
--   ALTER TABLE workspace_connections
--     DROP COLUMN IF EXISTS user_oauth_token_id,
--     DROP COLUMN IF EXISTS owner_user_id;
