-- Backfill default privacy preference to allow workflow insights (true) where missing
-- This sets users.settings.privacy.share_workflows_for_improvement to true only if absent
UPDATE users
SET settings = jsonb_set(
  settings,
  '{privacy,share_workflows_for_improvement}',
  'true'::jsonb,
  true
)
WHERE NOT (settings ? 'privacy')
   OR NOT ((settings->'privacy') ? 'share_workflows_for_improvement');

-- Rollback (optional/no-op):
-- To revert only keys set by this migration without affecting user changes, we'd need audit.
-- As a safe fallback, do nothing here.
