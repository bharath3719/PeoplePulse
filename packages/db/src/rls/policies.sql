-- ============================================================================
-- Row-Level Security — the tenant isolation backstop (NFR-07)
-- ============================================================================
--
-- The application layer already scopes every query by tenant. This exists for
-- the day it doesn't: a forgotten WHERE clause, a hand-written report query, a
-- new developer's first PR. RLS makes a cross-tenant read IMPOSSIBLE rather
-- than merely unlikely — which matters, because these tables hold salary, PAN,
-- and bank details (BRD risk R4).
--
-- HOW TENANT CONTEXT ARRIVES:
--   withTenant() in client.ts opens a transaction and calls
--     set_config('app.current_tenant', $1, is_local => true)
--   The `is_local => true` is load-bearing. See ADR-005 D-2.
--
-- FAIL-CLOSED:
--   current_setting('app.current_tenant', true) returns NULL when unset.
--   `tenant_id = NULL` evaluates to NULL, which is not TRUE, so the row is
--   filtered out. A query with no tenant context therefore returns ZERO ROWS
--   rather than ALL ROWS. That is the correct direction to fail.
--
-- FORCE ROW LEVEL SECURITY:
--   Plain ENABLE does not apply to the table's OWNER. Our migration user owns
--   these tables, and in many deployments the app connects as the owner too.
--   FORCE closes that hole. Without it, RLS is decorative.
-- ============================================================================

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
  SELECT nullif(current_setting('app.current_tenant', true), '')::uuid;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION current_tenant_id() IS
  'Resolves the active tenant from transaction-local config. NULL when unset, which fails closed.';

-- ---------------------------------------------------------------------------
-- Apply to every tenant-owned table.
-- ---------------------------------------------------------------------------
--
-- THREE TABLES ARE DELIBERATELY ABSENT, and they form the identity layer that
-- sits OUTSIDE the tenant boundary:
--
--   * tenant       - you cannot look up a company while scoped to a company.
--   * user         - login happens before any tenant is known.
--   * user_tenant  - this is the table that ANSWERS "which companies does this
--                    login belong to?" (D-16, the company switcher). Putting it
--                    under RLS is circular: you would need a tenant context to
--                    discover which tenant context you are allowed to have.
--
-- These three are the bootstrap. Everything downstream of them — roles,
-- permissions, org, employees, audit — IS under RLS, so the blast radius of the
-- exemption is small: `user_tenant` holds only (user_id, tenant_id, employee_id)
-- linkage, no business data, and the application only ever queries it filtered
-- by user_id.
--
-- Roles and permissions are NOT exempt. They are loaded inside a tenant context
-- after login has established one — which matters, because for a user who
-- belongs to several companies (the CA firm), leaking a role across tenants
-- would be privilege escalation, not merely a data leak.

DO $$
DECLARE
  t text;
  tenant_owned_tables text[] := ARRAY[
    'role',
    'role_permission',
    'user_role',
    'location',
    'department',
    'designation',
    'grade',
    'employee',
    'employee_event',
    'audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_owned_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);

    -- USING      -> which rows this transaction may READ / UPDATE / DELETE
    -- WITH CHECK -> which rows this transaction may WRITE
    --
    -- Both are required. USING alone would let a caller INSERT a row belonging
    -- to another tenant — writable but invisible, which is arguably worse than
    -- a leak.
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING      (tenant_id = current_tenant_id())
        WITH CHECK (tenant_id = current_tenant_id())
    $p$, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- The audit log is append-only (ADM-03, NFR-08)
-- ---------------------------------------------------------------------------
--
-- Statutory records must be retained for >= 8 years and be tamper-evident. A
-- log the application can rewrite is not evidence of anything, so the
-- application role simply does not hold the grant.
--
-- This is enforced at the database, not in code, because code changes.

REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peoplepulse_app') THEN
    REVOKE UPDATE, DELETE ON audit_log FROM peoplepulse_app;
    GRANT INSERT, SELECT ON audit_log TO peoplepulse_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Purge mode — the ONE sanctioned way these rows ever disappear
-- ---------------------------------------------------------------------------
--
-- Append-only cannot mean "never deletable, ever", because ADM-05 requires
-- account closure and DPDP grants a data-principal erasure right. When a
-- customer leaves and their retention period expires, the rows must actually go.
--
-- So the triggers below block UPDATE and DELETE for all normal traffic, and
-- yield only when `app.purge_mode` is explicitly switched on. Nothing in the
-- request path ever sets it — it is set solely by the account-closure /
-- retention-purge job, which is privileged and audited.
--
-- The effect: an ordinary bug, a rogue query, or a compromised app session
-- CANNOT erase the audit trail. A deliberate, named, logged operation can.
-- That is the distinction NFR-08 actually needs — tamper-EVIDENT, not
-- indestructible.

CREATE OR REPLACE FUNCTION is_purge_mode() RETURNS boolean AS $$
  SELECT coalesce(current_setting('app.purge_mode', true), 'off') = 'on';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  IF is_purge_mode() AND TG_OP = 'DELETE' THEN
    RETURN OLD;  -- retention purge / account closure (ADM-05)
  END IF;
  RAISE EXCEPTION 'audit_log is append-only (NFR-08): % is not permitted', TG_OP;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_mutation ON audit_log;
CREATE TRIGGER audit_log_no_mutation
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

-- ---------------------------------------------------------------------------
-- employee_event is immutable too (CHR-07)
-- ---------------------------------------------------------------------------
--
-- A promotion recorded in error is corrected by a NEW event, never by editing
-- the old one. That is what makes "what was this person's designation in
-- March?" answerable at all.
--
-- Note UPDATE is refused even in purge mode. There is no legitimate reason to
-- REWRITE history — only to erase it wholesale when the company leaves.

CREATE OR REPLACE FUNCTION employee_event_is_immutable() RETURNS trigger AS $$
BEGIN
  IF is_purge_mode() AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'employee_event is immutable (CHR-07): correct it with a new event, not a %', TG_OP;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS employee_event_no_mutation ON employee_event;
CREATE TRIGGER employee_event_no_mutation
  BEFORE UPDATE OR DELETE ON employee_event
  FOR EACH ROW EXECUTE FUNCTION employee_event_is_immutable();
