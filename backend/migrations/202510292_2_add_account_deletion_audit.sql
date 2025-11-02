CREATE TABLE account_deletion_tokens (
    token TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_account_deletion_tokens_user_id ON account_deletion_tokens(user_id);

CREATE TABLE account_deletion_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    email TEXT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL,
    confirmed_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    workflow_count INTEGER NOT NULL,
    owned_workspace_count INTEGER NOT NULL,
    member_workspace_count INTEGER NOT NULL,
    stripe_customer_id TEXT,
    oauth_provider TEXT,
    ip_address TEXT,
    user_agent TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_account_deletion_audit_user_id ON account_deletion_audit(user_id);

-- Rollback:
--   DROP INDEX IF EXISTS idx_account_deletion_audit_user_id;
--   DROP TABLE IF EXISTS account_deletion_audit;
--   DROP INDEX IF EXISTS idx_account_deletion_tokens_user_id;
--   DROP TABLE IF EXISTS account_deletion_tokens;
