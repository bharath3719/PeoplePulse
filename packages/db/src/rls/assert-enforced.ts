import { sql } from 'drizzle-orm';
import type { Database } from '../client';

export class RlsNotEnforcedError extends Error {
  override name = 'RlsNotEnforcedError';
}

/**
 * Refuse to run if row-level security is not actually in force.
 *
 * Called at API boot and at the top of the isolation suite. It exists because
 * we shipped — briefly — a system where every policy was correct, every table
 * had ENABLE + FORCE ROW LEVEL SECURITY, the migration verified both and
 * reported success, and tenant isolation did not work at all.
 *
 * The reason: the app was connecting as `postgres`, a superuser. Superusers and
 * any role with BYPASSRLS skip RLS entirely — the policies are never consulted.
 * Nothing in the schema can tell you this. You have to check the ROLE.
 *
 * So this asserts all three, and the first is the one that actually bites:
 *
 *   1. the connecting role cannot bypass RLS
 *   2. RLS is ENABLED on every tenant-owned table
 *   3. RLS is FORCED (which closes the gap for the table owner)
 *
 * A failure here is a hard stop, never a warning. A system that cannot isolate
 * tenants must not accept traffic — it holds salary, PAN, and bank details
 * (BRD risk R4).
 */
export const TENANT_OWNED_TABLES = [
  'role', 'role_permission', 'user_role', 'user_invitation',
  'location', 'department', 'designation', 'grade',
  'employee', 'employee_event', 'audit_log',
] as const;

export async function assertRlsEnforced(db: Database): Promise<void> {
  // --- 1. The role. This is the check that catches the real bug. ------------
  const roleResult = await db.execute<{
    role: string; is_superuser: boolean; bypasses_rls: boolean;
  }>(sql`
    select current_user               as role,
           rolsuper                   as is_superuser,
           rolbypassrls               as bypasses_rls
    from pg_roles
    where rolname = current_user
  `);

  const role = roleResult.rows[0];
  if (!role) throw new RlsNotEnforcedError('could not resolve the current database role');

  if (role.is_superuser || role.bypasses_rls) {
    throw new RlsNotEnforcedError(
      `The application is connected as "${role.role}", which ` +
      `${role.is_superuser ? 'is a SUPERUSER' : 'has BYPASSRLS'}. ` +
      'Row-level security is therefore IGNORED and tenants are NOT isolated, ' +
      'no matter how correct the policies are. ' +
      'Connect as `peoplepulse_app` instead (see packages/db/src/rls/app-role.sql).',
    );
  }

  // --- 2 & 3. The tables. --------------------------------------------------
  const tableResult = await db.execute<{
    tablename: string; rls: boolean; forced: boolean;
  }>(sql`
    select c.relname             as tablename,
           c.relrowsecurity      as rls,
           c.relforcerowsecurity as forced
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (${sql.join(TENANT_OWNED_TABLES.map((t) => sql`${t}`), sql`, `)})
  `);

  const found = new Set(tableResult.rows.map((r) => r.tablename));
  const missing = TENANT_OWNED_TABLES.filter((t) => !found.has(t));
  if (missing.length > 0) {
    throw new RlsNotEnforcedError(`tables not found (migration not run?): ${missing.join(', ')}`);
  }

  const unprotected = tableResult.rows.filter((r) => !r.rls || !r.forced);
  if (unprotected.length > 0) {
    throw new RlsNotEnforcedError(
      'Row-level security is not enforced on: ' +
      unprotected.map((t) => `${t.tablename}(${!t.rls ? 'not enabled' : 'not forced'})`).join(', '),
    );
  }
}
