-- Add per-workflow security settings
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS egress_allowlist TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS require_hmac BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hmac_replay_window_sec INT NOT NULL DEFAULT 300;

-- Rollback:
--   ALTER TABLE workflows
--     DROP COLUMN IF EXISTS egress_allowlist,
--     DROP COLUMN IF EXISTS require_hmac,
--     DROP COLUMN IF EXISTS hmac_replay_window_sec;

