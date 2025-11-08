CREATE TABLE user_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX user_sessions_user_id_idx ON user_sessions USING BTREE (user_id);
CREATE INDEX user_sessions_expires_at_idx ON user_sessions USING BTREE (expires_at);

-- Rollback:
--   DROP INDEX IF EXISTS user_sessions_expires_at_idx;
--   DROP INDEX IF EXISTS user_sessions_user_id_idx;
--   DROP TABLE IF EXISTS user_sessions;

