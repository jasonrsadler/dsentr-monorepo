-- Add Slack as a supported OAuth provider for user and workspace connections.
ALTER TYPE oauth_connection_provider ADD VALUE IF NOT EXISTS 'slack';
