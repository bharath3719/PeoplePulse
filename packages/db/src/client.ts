import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema/index';

export type Database = NodePgDatabase<typeof schema>;
export type TenantDatabase = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Postgres numeric handling.
 *
 * Money is stored as BIGINT paise (ADR-005). node-postgres returns BIGINT as a
 * STRING by default, to avoid silently truncating values beyond 2^53. Our
 * amounts are nowhere near that — a rupee crore is 10^11 paise, and
 * Number.MAX_SAFE_INTEGER is 9x10^15 — so parsing to a number is safe, and it
 * gives us the integer `Paise` type with no conversion step at all.
 *
 * This is the whole reason money is BIGINT paise and not NUMERIC(14,2): NUMERIC
 * comes back as a string that must be parsed on EVERY read, which re-introduces
 * the exact float boundary we removed.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

let pool: pg.Pool | undefined;
let db: Database | undefined;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function getDb(connectionString?: string): Database {
  if (!db) {
    const conn = connectionString ?? process.env['DATABASE_URL'];
    if (!conn) throw new Error('DATABASE_URL is not set');
    pool = createPool(conn);
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

export class TenantContextError extends Error {}

/**
 * ============================================================================
 * THE MOST IMPORTANT FUNCTION IN THE CODEBASE.
 * ============================================================================
 *
 * Every query against a tenant-owned table runs inside here. No exceptions.
 *
 * WHY IT IS A TRANSACTION AND NOT A SESSION SETTING:
 *
 * The obvious implementation is `SET app.current_tenant = '...'` on the
 * connection, once per request. The TRD (TR-01) originally said exactly that,
 * and it is WRONG in a way that does not show up in testing.
 *
 * Under a transaction-mode connection pooler — PgBouncer, RDS Proxy, Supabase's
 * pooler — a physical connection is handed back to the pool at the end of each
 * TRANSACTION, not each request. So a session-scoped `SET` can outlive the
 * request that made it and be inherited by the NEXT request, which may belong
 * to a different company. One tenant reads another tenant's payroll. No error,
 * no log line, no test failure.
 *
 * `set_config(..., is_local => true)` is the transaction-scoped equivalent of
 * `SET LOCAL`. Postgres discards it at COMMIT or ROLLBACK, so it cannot leak
 * across a pooled connection handoff. (We use set_config() rather than the
 * literal `SET LOCAL` statement because SET does not accept bind parameters,
 * and interpolating a tenant id into SQL is how you get SQL injection.)
 *
 * See ADR-005 D-2.
 */
export async function withTenant<T>(
  database: Database,
  tenantId: string,
  fn: (tx: TenantDatabase) => Promise<T>,
): Promise<T> {
  if (!tenantId) throw new TenantContextError('withTenant called with no tenant id');

  return database.transaction(async (tx) => {
    // is_local = true  ->  scoped to THIS transaction, discarded on commit.
    await tx.execute(sql`select set_config('app.current_tenant', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * An escape hatch for genuinely cross-tenant work: the login flow (which must
 * resolve a user's companies BEFORE a tenant context exists), platform
 * migrations, and the internal support console.
 *
 * It is named to be conspicuous in a code review. If you are reaching for this
 * inside a feature module, you are almost certainly about to write a
 * cross-tenant data leak.
 */
export async function withoutTenantIsolation<T>(
  database: Database,
  reason: string,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  if (!reason) throw new TenantContextError('withoutTenantIsolation requires a stated reason');
  return fn(database);
}

/**
 * Purge mode: the ONLY way audit_log and employee_event rows are ever deleted.
 *
 * Those tables are append-only (NFR-08, CHR-07) and guarded by database
 * triggers, so a bug, a rogue query, or a compromised session cannot erase the
 * audit trail. But "append-only" cannot mean "immortal": ADM-05 requires
 * account closure, and DPDP grants an erasure right. When a customer leaves and
 * their statutory retention window expires, the rows must actually go.
 *
 * This function is the sanctioned door. It is deliberately awkward to call, it
 * demands a written reason, and every use of it should be visible in a code
 * review from across the room. There should be exactly TWO callers, ever: the
 * account-closure job and the retention-purge job.
 *
 * If you are calling this from a feature module, stop.
 */
export async function withPurgeMode<T>(
  database: Database,
  tenantId: string,
  reason: string,
  fn: (tx: TenantDatabase) => Promise<T>,
): Promise<T> {
  if (!reason) throw new TenantContextError('withPurgeMode requires a stated reason');

  return database.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_tenant', ${tenantId}, true)`);
    await tx.execute(sql`select set_config('app.purge_mode', 'on', true)`);
    return fn(tx);
  });
}
