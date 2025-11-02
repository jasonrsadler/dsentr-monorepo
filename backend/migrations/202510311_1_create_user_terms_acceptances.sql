CREATE TABLE IF NOT EXISTS user_terms_acceptances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    terms_version TEXT NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_terms_acceptances_user_version_idx
    ON user_terms_acceptances (user_id, terms_version);

-- Rollback:
--   DROP INDEX IF EXISTS user_terms_acceptances_user_version_idx;
--   DROP TABLE IF EXISTS user_terms_acceptances;
