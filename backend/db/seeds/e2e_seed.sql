-- ============================================================
-- HARD RESET FOR E2E
-- ============================================================

TRUNCATE user_sessions CASCADE;

TRUNCATE workspace_members CASCADE;

TRUNCATE workspaces CASCADE;

TRUNCATE users CASCADE;

-- Common hash: password123
-- $argon2id$v=19$m=19456,t=2,p=1$zq6FgfuQ+40xxeU8WrgiQA$hmwCWeJLIAduGhozodwDOGHVQwMbKDSLJLyFdm5BHOY

-- ============================================================
-- MAIN TEST USER (has a workspace, has memberships)
-- ============================================================

INSERT INTO
    users (
        id,
        email,
        password_hash,
        first_name,
        last_name,
        company_name,
        country,
        tax_id,
        stripe_customer_id,
        is_subscribed,
        plan,
        trial_ends_at,
        settings,
        created_at,
        updated_at,
        is_verified,
        role,
        oauth_provider,
        onboarded_at
    )
VALUES (
        '11111111-1111-1111-1111-111111111111',
        'test@example.com',
        '$argon2id$v=19$m=19456,t=2,p=1$zq6FgfuQ+40xxeU8WrgiQA$hmwCWeJLIAduGhozodwDOGHVQwMbKDSLJLyFdm5BHOY',
        'E2E',
        'User',
        NULL,
        NULL,
        NULL,
        NULL,
        false,
        'workspace',
        NULL,
        '{}',
        NOW(),
        NOW(),
        true,
        'user',
        'email',
        NOW()
    );

-- ============================================================
-- TEST USER’S MAIN WORKSPACE
-- ============================================================

INSERT INTO
    workspaces (
        id,
        name,
        created_by,
        created_at,
        updated_at,
        owner_id,
        plan,
        deleted_at,
        stripe_overage_item_id
    )
VALUES (
        '22222222-2222-2222-2222-222222222222',
        'E2E Workspace',
        '11111111-1111-1111-1111-111111111111',
        NOW(),
        NOW(),
        '11111111-1111-1111-1111-111111111111',
        'workspace',
        NULL,
        NULL
    );

INSERT INTO
    workspace_members (
        workspace_id,
        user_id,
        role,
        joined_at
    )
VALUES (
        '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'owner',
        NOW()
    );

-- ============================================================
-- USER WITH ZERO WORKSPACES
-- ============================================================

INSERT INTO
    users (
        id,
        email,
        password_hash,
        first_name,
        last_name,
        company_name,
        country,
        tax_id,
        stripe_customer_id,
        is_subscribed,
        plan,
        trial_ends_at,
        settings,
        created_at,
        updated_at,
        is_verified,
        role,
        oauth_provider,
        onboarded_at
    )
VALUES (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'noworkspace@example.com',
        '$argon2id$v=19$m=19456,t=2,p=1$zq6FgfuQ+40xxeU8WrgiQA$hmwCWeJLIAduGhozodwDOGHVQwMbKDSLJLyFdm5BHOY',
        'No Workspace',
        'User',
        NULL,
        NULL,
        NULL,
        NULL,
        false,
        'solo',
        NULL,
        '{}',
        NOW(),
        NOW(),
        true,
        'user',
        'email',
        NOW()
    );

-- ============================================================
-- USER WHO REQUIRES ONBOARDING (onboarded_at = NULL)
-- ============================================================

INSERT INTO
    users (
        id,
        email,
        password_hash,
        first_name,
        last_name,
        company_name,
        country,
        tax_id,
        stripe_customer_id,
        is_subscribed,
        plan,
        trial_ends_at,
        settings,
        created_at,
        updated_at,
        is_verified,
        role,
        oauth_provider,
        onboarded_at
    )
VALUES (
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'onboardinguser@example.com',
        '$argon2id$v=19$m=19456,t=2,p=1$zq6FgfuQ+40xxeU8WrgiQA$hmwCWeJLIAduGhozodwDOGHVQwMbKDSLJLyFdm5BHOY',
        'Onboarding',
        'User',
        NULL,
        NULL,
        NULL,
        NULL,
        false,
        'solo',
        NULL,
        '{}',
        NOW(),
        NOW(),
        true,
        'user',
        'email',
        NULL -- onboarding required
    );

-- ============================================================
-- SECONDARY WORKSPACE + OWNER + TEST USER AS MEMBER
-- (for workspace switcher tests)
-- ============================================================

-- owner of W2
INSERT INTO
    users (
        id,
        email,
        password_hash,
        first_name,
        last_name,
        company_name,
        country,
        tax_id,
        stripe_customer_id,
        is_subscribed,
        plan,
        trial_ends_at,
        settings,
        created_at,
        updated_at,
        is_verified,
        role,
        oauth_provider,
        onboarded_at
    )
VALUES (
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'other@example.com',
        '$argon2id$v=19$m=19456,t=2,p=1$zq6FgfuQ+40xxeU8WrgiQA$hmwCWeJLIAduGhozodwDOGHVQwMbKDSLJLyFdm5BHOY',
        'Other',
        'Owner',
        NULL,
        NULL,
        NULL,
        NULL,
        false,
        'workspace',
        NULL,
        '{}',
        NOW(),
        NOW(),
        true,
        'user',
        'email',
        NOW()
    );

-- W2 workspace
INSERT INTO
    workspaces (
        id,
        name,
        created_by,
        created_at,
        updated_at,
        owner_id,
        plan,
        deleted_at,
        stripe_overage_item_id
    )
VALUES (
        'dddddddd-dddd-dddd-dddd-dddddddddddd',
        'Secondary Workspace',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        NOW(),
        NOW(),
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'workspace',
        NULL,
        NULL
    );

-- memberships
INSERT INTO
    workspace_members (
        workspace_id,
        user_id,
        role,
        joined_at
    )
VALUES (
        'dddddddd-dddd-dddd-dddd-dddddddddddd',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'owner',
        NOW()
    );

INSERT INTO
    workspace_members (
        workspace_id,
        user_id,
        role,
        joined_at
    )
VALUES (
        'dddddddd-dddd-dddd-dddd-dddddddddddd',
        '11111111-1111-1111-1111-111111111111',
        'user',
        NOW()
    );

-- Give other@example.com access to the main E2E workspace
INSERT INTO
    workspace_members (
        workspace_id,
        user_id,
        role,
        joined_at
    )
VALUES (
        '22222222-2222-2222-2222-222222222222', -- E2E Workspace
        'cccccccc-cccc-cccc-cccc-cccccccccccc', -- other@example.com
        'user',
        NOW()
    )
ON CONFLICT DO NOTHING;