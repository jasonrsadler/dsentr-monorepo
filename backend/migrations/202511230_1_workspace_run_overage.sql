ALTER TABLE workspace_run_usage
    ADD COLUMN overage_count BIGINT NOT NULL DEFAULT 0;

-- Rollback:
--   ALTER TABLE workspace_run_usage DROP COLUMN IF EXISTS overage_count;
