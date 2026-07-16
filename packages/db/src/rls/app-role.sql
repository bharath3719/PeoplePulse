-- ============================================================================
-- The application database role
-- ============================================================================
--
-- THE APPLICATION MUST NEVER CONNECT AS A SUPERUSER.
--
-- This is not hygiene. It is the difference between having tenant isolation and
-- only appearing to.
--
-- PostgreSQL superusers — and any role with BYPASSRLS — IGNORE row-level
-- security completely. Not "are permitted by the policy": the policy is never
-- consulted. `FORCE ROW LEVEL SECURITY` does not help; that only closes the
-- gap for the table's OWNER, not for a superuser.
--
-- So a system can have:
--   * correct policies on every table                          ✓
--   * ENABLE + FORCE ROW LEVEL SECURITY on every table         ✓
--   * a migration that verifies both and reports success       ✓
--   * and still zero tenant isolation                          ✗
--
-- ...if the app happens to connect as `postgres`. Which is the default in every
-- local setup, every quickstart, and most Docker composes. We caught this
-- exactly that way: our own isolation suite showed one tenant inserting rows
-- into another tenant's data while the migration cheerfully reported
-- "RLS enforced on 11 tenant-owned tables".
--
-- Hence: a dedicated, deliberately unprivileged role. NOSUPERUSER, NOBYPASSRLS,
-- NOCREATEDB, NOCREATEROLE. It can read and write rows and nothing else — and
-- RLS applies to it in full.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peoplepulse_app') THEN
    EXECUTE format(
      'CREATE ROLE peoplepulse_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT',
      current_setting('app.bootstrap_password')
    );
  ELSE
    -- Idempotent, and self-healing: if someone has granted this role superuser
    -- or BYPASSRLS in the meantime, take it back.
    EXECUTE format(
      'ALTER ROLE peoplepulse_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE',
      current_setting('app.bootstrap_password')
    );
  END IF;
END $$;

-- GRANT ... ON DATABASE takes a literal name, not an expression, so it has to
-- go through format() with current_database().
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO peoplepulse_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO peoplepulse_app;

-- Data access, and nothing more. No DDL: the app cannot ALTER TABLE, cannot
-- DROP POLICY, cannot turn RLS off. Migrations run as the owner; the app does not.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO peoplepulse_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO peoplepulse_app;

-- Tables created by future migrations get the same treatment automatically,
-- so a new table cannot accidentally be unreachable — or over-reachable.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO peoplepulse_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO peoplepulse_app;

-- The audit log is append-only (NFR-08). The app holds no grant to rewrite it.
-- The trigger in policies.sql is the second lock; this is the first.
REVOKE UPDATE, DELETE ON audit_log FROM peoplepulse_app;
REVOKE UPDATE, DELETE ON employee_event FROM peoplepulse_app;
