-- Add Slack as a supported OAuth provider for user and workspace connections.
ALTER TYPE oauth_connection_provider ADD VALUE IF NOT EXISTS 'slack';

-- Rollback:
--   PostgreSQL does not support removing enum values in place. To drop 'slack',
--   create a replacement type without the value, update dependent columns, and
--   swap types following the procedure in the PostgreSQL documentation.
