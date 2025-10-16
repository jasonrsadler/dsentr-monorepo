-- Consolidate workspace ownership and remove legacy organization tables
DO $$
DECLARE
    rec RECORD;
BEGIN
    -- Ensure the workspace_role enum includes the owner value so we can remap
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'workspace_role' AND e.enumlabel = 'owner'
    ) THEN
        ALTER TYPE workspace_role ADD VALUE 'owner';
    END IF;

    FOR rec IN
        SELECT
            w.id AS workspace_id,
            COALESCE(
                (
                    SELECT om.user_id
                    FROM organization_members om
                    WHERE om.organization_id = w.organization_id
                        AND om.role = 'owner'::organization_role
                    ORDER BY om.joined_at ASC
                    LIMIT 1
                ),
                w.created_by
            ) AS owner_id
        FROM workspaces w
        WHERE w.organization_id IS NOT NULL
    LOOP
        IF rec.owner_id IS NULL THEN
            CONTINUE;
        END IF;

        UPDATE workspace_members
        SET role = 'owner'::workspace_role
        WHERE workspace_id = rec.workspace_id
            AND user_id = rec.owner_id;

        IF NOT FOUND THEN
            INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
            VALUES (rec.workspace_id, rec.owner_id, 'owner'::workspace_role, NOW())
            ON CONFLICT (workspace_id, user_id)
            DO UPDATE SET role = 'owner'::workspace_role;
        END IF;
    END LOOP;
END $$;

DROP INDEX IF EXISTS idx_workspaces_organization_id;
ALTER TABLE workspaces
    DROP COLUMN IF EXISTS organization_id;

DROP INDEX IF EXISTS idx_organization_owner_unique;
DROP TABLE IF EXISTS organization_members;
DROP TABLE IF EXISTS organizations;
DROP TYPE IF EXISTS organization_role;
