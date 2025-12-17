ALTER TABLE workspace_connections
ADD COLUMN bot_user_id TEXT,
ADD COLUMN slack_team_id TEXT,
ADD COLUMN incoming_webhook_url TEXT;
