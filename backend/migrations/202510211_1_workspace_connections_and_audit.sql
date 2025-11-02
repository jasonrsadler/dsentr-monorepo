CREATE TABLE workspace_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider oauth_connection_provider NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  account_email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

CREATE INDEX workspace_connections_workspace_idx
  ON workspace_connections(workspace_id);

ALTER TABLE user_oauth_tokens
  ADD COLUMN is_shared BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE workspace_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX workspace_audit_events_workspace_idx
  ON workspace_audit_events(workspace_id);

-- Rollback:
--   DROP INDEX IF EXISTS workspace_audit_events_workspace_idx;
--   DROP TABLE IF EXISTS workspace_audit_events;
--   ALTER TABLE user_oauth_tokens DROP COLUMN IF EXISTS is_shared;
--   DROP INDEX IF EXISTS workspace_connections_workspace_idx;
--   DROP TABLE IF EXISTS workspace_connections;
