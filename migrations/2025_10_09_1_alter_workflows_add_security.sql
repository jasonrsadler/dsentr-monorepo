-- Add per-workflow security settings
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS egress_allowlist TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS require_hmac BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hmac_replay_window_sec INT NOT NULL DEFAULT 300;

