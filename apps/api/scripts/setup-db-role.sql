-- One-time, run once per database as a superuser/admin BEFORE pointing
-- DATABASE_URL at the new role (see CLAUDE.md). Creates a plain (non-super,
-- NOBYPASSRLS) role for the app to connect as — required for the RLS
-- policies in migrations/0002_pages_rls.sql to have any effect at all:
-- Postgres superusers (and any BYPASSRLS role) ignore RLS unconditionally,
-- even with FORCE ROW LEVEL SECURITY, so running the app as "postgres" (the
-- common local-dev default) makes those policies a silent no-op.
-- Database creation uses the separate usim_cms_provisioner credential.
-- The request-serving usim_cms_app role must remain NOCREATEDB.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'usim_cms_app') THEN
    CREATE ROLE usim_cms_app LOGIN PASSWORD 'usim_cms_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'usim_cms_provisioner') THEN
    CREATE ROLE usim_cms_provisioner LOGIN PASSWORD 'usim_cms_provisioner' NOSUPERUSER NOBYPASSRLS CREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

-- Upgrade existing installations: remove database-creation privilege from
-- the API role and keep it only on the provisioner login. NOINHERIT prevents
-- the provisioner from implicitly using app privileges; membership is used
-- only for the explicit database-owner transfer during provisioning.
ALTER ROLE usim_cms_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE usim_cms_provisioner LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
GRANT usim_cms_app TO usim_cms_provisioner;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO usim_cms_app', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO usim_cms_provisioner', current_database());
END
$$;

GRANT USAGE, CREATE ON SCHEMA public TO usim_cms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO usim_cms_app;

-- Table OWNERSHIP, not just GRANT ALL PRIVILEGES: ALTER TABLE ... ENABLE/
-- FORCE ROW LEVEL SECURITY and CREATE POLICY (run on every tenant schema by
-- ensureTenantSchema's migration replay) require the connecting role to own
-- the table, or be superuser. Tables created before this role existed
-- (public schema, and any tenant_% schema from an earlier local run) are
-- still owned by whichever role ran the app previously — reassign them.
-- Schemas/tables this role creates itself from now on are automatically its
-- own, no reassignment needed for those.
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN
    SELECT schemaname, tablename FROM pg_tables
    WHERE schemaname = 'public' OR schemaname LIKE 'tenant_%'
  LOOP
    EXECUTE format('GRANT USAGE, CREATE ON SCHEMA %I TO usim_cms_app', t.schemaname);
    EXECUTE format('ALTER TABLE %I.%I OWNER TO usim_cms_app', t.schemaname, t.tablename);
  END LOOP;
END
$$;
