-- Harden database roles and privileges for dsentr

-- Create core roles if they do not exist yet
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

-- Ensure PUBLIC does not retain broad access
REVOKE ALL ON DATABASE dsentr FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Assign ownership to the dedicated owner role
ALTER DATABASE dsentr OWNER TO dsentr_owner;
ALTER SCHEMA public OWNER TO dsentr_owner;

DO $$
DECLARE
    obj RECORD;
BEGIN
    FOR obj IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I OWNER TO dsentr_owner', obj.tablename);
    END LOOP;
    FOR obj IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER SEQUENCE public.%I OWNER TO dsentr_owner', obj.sequencename);
    END LOOP;
END
$$;

-- Grant minimal runtime access to application roles
GRANT CONNECT ON DATABASE dsentr TO dsentr_app, dsentr_readonly;
GRANT USAGE ON SCHEMA public TO dsentr_app, dsentr_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dsentr_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dsentr_readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dsentr_app;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO dsentr_readonly;

-- Ensure future objects inherit the hardened defaults
ALTER DEFAULT PRIVILEGES FOR ROLE dsentr_owner IN SCHEMA public
    REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE dsentr_owner IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE dsentr_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dsentr_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dsentr_owner IN SCHEMA public
    GRANT SELECT ON TABLES TO dsentr_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE dsentr_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO dsentr_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dsentr_owner IN SCHEMA public
    GRANT SELECT ON SEQUENCES TO dsentr_readonly;

-- Documented rollback: reassign ownership and grants back to prior superuser if necessary.
-- Example rollback commands:
--   ALTER DATABASE dsentr OWNER TO CURRENT_USER;
--   ALTER SCHEMA public OWNER TO CURRENT_USER;
--   GRANT ALL ON DATABASE dsentr TO PUBLIC;
--   GRANT ALL ON SCHEMA public TO PUBLIC;
