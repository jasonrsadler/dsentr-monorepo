-- Add per-workflow concurrency limit
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS concurrency_limit INT NOT NULL DEFAULT 1;

