CREATE TYPE oauth_connection_provider AS ENUM ('google', 'microsoft');

CREATE TABLE user_oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider oauth_connection_provider NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  account_email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX user_oauth_tokens_user_idx ON user_oauth_tokens(user_id);

-- Rollback:
--   DROP INDEX IF EXISTS user_oauth_tokens_user_idx;
--   DROP TABLE IF EXISTS user_oauth_tokens;
--   DROP TYPE IF EXISTS oauth_connection_provider;
