-- Track where and when users sign in so admins can audit access patterns.
CREATE TABLE IF NOT EXISTS user_login_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    session_id UUID NOT NULL,
    ip_address INET NOT NULL,
    user_agent TEXT,
    city TEXT,
    region TEXT,
    country TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    is_proxy BOOLEAN,
    is_vpn BOOLEAN,
    lookup_raw JSONB,
    logged_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    logged_out_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_login_activity_session_id_idx
    ON user_login_activity(session_id);
CREATE INDEX IF NOT EXISTS user_login_activity_user_id_idx
    ON user_login_activity(user_id);
CREATE INDEX IF NOT EXISTS user_login_activity_logged_in_idx
    ON user_login_activity(logged_in_at DESC);

-- Rollback:
--   DROP INDEX IF EXISTS user_login_activity_logged_in_idx;
--   DROP INDEX IF EXISTS user_login_activity_user_id_idx;
--   DROP INDEX IF EXISTS user_login_activity_session_id_idx;
--   DROP TABLE IF EXISTS user_login_activity;
