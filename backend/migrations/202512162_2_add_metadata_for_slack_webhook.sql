ALTER TABLE workspace_connections
ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
