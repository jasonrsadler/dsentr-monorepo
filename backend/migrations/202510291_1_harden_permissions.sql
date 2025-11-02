-- Harden database roles and privileges within current Neon database
-- Compatible with Neon’s restricted permissions model (no superuser, no ALTER OWNER)

-- Create core roles if they do not exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsentr_owner') THEN
        CREATE ROLE dsentr_owner NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsentr_app') THEN
        CREATE ROLE dsentr_app NOINHERIT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsentr_readonly') THEN
        CREATE ROLE dsentr_readonly NOINHERIT;
    END IF;
END
$$;

-- Restrict PUBLIC and apply schema lockdown
DO $$
DECLARE
    dbname text;
BEGIN
    SELECT current_database() INTO dbname;

    -- Restrict PUBLIC privileges
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', dbname);
    EXECUTE 'REVOKE ALL ON SCHEMA public FROM PUBLIC';
    EXECUTE 'REVOKE CREATE ON SCHEMA public FROM PUBLIC';

    -- Instead of ALTER OWNER (disallowed on Neon), just give full control
    EXECUTE 'GRANT ALL ON SCHEMA public TO dsentr_owner';
END
$$;

-- Grant control over existing objects to dsentr_owner
DO $$
DECLARE
    obj RECORD;
BEGIN
    FOR obj IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('GRANT ALL ON TABLE public.%I TO dsentr_owner', obj.tablename);
    END LOOP;

    FOR obj IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
        EXECUTE format('GRANT ALL ON SEQUENCE public.%I TO dsentr_owner', obj.sequencename);
    END LOOP;
END
$$;

-- Grant runtime access to application roles
DO $$
DECLARE
    dbname text;
BEGIN
    SELECT current_database() INTO dbname;
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO dsentr_app, dsentr_readonly', dbname);
END
$$;

-- Basic schema and table/sequence access
GRANT USAGE ON SCHEMA public TO dsentr_app, dsentr_readonly;

GRANT
SELECT, INSERT,
UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dsentr_app;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO dsentr_readonly;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dsentr_app;

GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO dsentr_readonly;

-- Default privilege configuration removed (Neon disallows ALTER DEFAULT PRIVILEGES)

-- Rollback example (manual if needed):
--   REVOKE ALL ON DATABASE current_database() FROM dsentr_app, dsentr_readonly;
--   GRANT ALL ON SCHEMA public TO PUBLIC;
--   DROP ROLE IF EXISTS dsentr_owner, dsentr_app, dsentr_readonly;