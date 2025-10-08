-- Add per-workflow salt to support token rotation without affecting other workflows
ALTER TABLE workflows
ADD COLUMN IF NOT EXISTS webhook_salt UUID NOT NULL DEFAULT gen_random_uuid();

