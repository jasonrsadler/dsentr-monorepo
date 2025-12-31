ALTER TYPE oauth_connection_provider ADD VALUE IF NOT EXISTS 'notion';

-- Rollback:
--   -- Postgres enums cannot drop values without recreating the type.
--   -- To rollback, create a new enum without 'notion', alter dependent columns
--   -- to the new type, and drop the old enum once no longer referenced.
