-- Ensure workflow names are unique per user, case-insensitively
-- 1) De-duplicate any existing conflicts by appending a numeric suffix
DO $$
DECLARE
  rec RECORD;
  base_name TEXT;
  suffix INT;
  candidate TEXT;
BEGIN
  -- Iterate over duplicates (same user_id + lower(name)), ordered by oldest first
  FOR rec IN
    SELECT id, user_id, name, rn
    FROM (
      SELECT w.id,
             w.user_id,
             w.name,
             row_number() OVER (PARTITION BY w.user_id, lower(w.name) ORDER BY w.created_at, w.id) AS rn
      FROM workflows w
    ) t
    WHERE rn > 1
    ORDER BY user_id, lower(name), rn
  LOOP
    base_name := rec.name;
    suffix := 2;
    candidate := base_name || ' (' || suffix || ')';
    -- Bump suffix until unique for the user (case-insensitive)
    WHILE EXISTS (
      SELECT 1 FROM workflows
      WHERE user_id = rec.user_id AND lower(name) = lower(candidate)
    ) LOOP
      suffix := suffix + 1;
      candidate := base_name || ' (' || suffix || ')';
    END LOOP;
    UPDATE workflows SET name = candidate WHERE id = rec.id;
  END LOOP;
END $$ LANGUAGE plpgsql;

-- 2) Create the unique index to enforce going forward
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_user_lower_name_unique
  ON workflows (user_id, (lower(name)));
