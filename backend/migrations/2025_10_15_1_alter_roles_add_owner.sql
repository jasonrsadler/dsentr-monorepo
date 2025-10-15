-- Add 'owner' role to workspace_role and organization_role enums
-- and enforce a single owner per workspace/organization.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'workspace_role' AND e.enumlabel = 'owner'
    ) THEN
        ALTER TYPE workspace_role ADD VALUE 'owner';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'organization_role' AND e.enumlabel = 'owner'
    ) THEN
        ALTER TYPE organization_role ADD VALUE 'owner';
    END IF;
END $$;

-- Unique owner per workspace
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_owner_unique
    ON workspace_members (workspace_id)
    WHERE role = 'owner'::workspace_role;

-- Unique owner per organization
CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_owner_unique
    ON organization_members (organization_id)
    WHERE role = 'owner'::organization_role;

