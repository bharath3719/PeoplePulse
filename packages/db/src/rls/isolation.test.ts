import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../migrate';
import { withTenant, withPurgeMode, type Database } from '../client';
import { assertRlsEnforced } from './assert-enforced';
import * as schema from '../schema/index';
import { tenant, employee, location } from '../schema/index';

/**
 * ============================================================================
 * TENANT ISOLATION (NFR-07, TR-62)
 * ============================================================================
 *
 * These tests exist to prove that one company CANNOT read another company's
 * data — the single most important guarantee in the product. The tables under
 * test hold salary, PAN, and bank details; a leak here is BRD risk R4.
 *
 * Every test below tries to BREAK isolation and asserts that it fails. A test
 * that only checks the happy path proves nothing — of course the query works
 * when you ask for your own data.
 */

/**
 * Two connection strings, and the distinction is the whole point.
 *
 *   TEST_MIGRATION_DATABASE_URL -> connects as postgres (the owner). Runs DDL.
 *   TEST_DATABASE_URL           -> connects as peoplepulse_app. Runs the tests.
 *
 * If the tests ran as the owner, they would ALL PASS while proving NOTHING:
 * superusers bypass row-level security entirely, so the policies would never be
 * consulted. That is not a hypothetical — it is what happened on the first run
 * of this file, and it is why assertRlsEnforced() below is the first thing
 * these tests do.
 */
const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const MIGRATION_URL = process.env['TEST_MIGRATION_DATABASE_URL'];
const APP_PW = process.env['APP_DB_PASSWORD'];

/**
 * These tests do NOT skip themselves when the database is absent.
 *
 * They used to: `describe.skip` when the URLs were unset. The result was that
 * `npm test` — which never loaded .env — printed "13 skipped" in grey, exited 0,
 * and told us the build was green. Thirteen tests whose entire purpose is to
 * prove that one company cannot read another's salary data were not running, and
 * nothing said so louder than a shrug.
 *
 * That is ADR-006's lesson wearing a different hat: the danger is not a failing
 * isolation check, it is an isolation check that ISN'T CHECKING while looking
 * like it is. So the default is now to fail. Skipping is still possible, but you
 * have to say so out loud.
 */
const OPTED_OUT = process.env['SKIP_DB_TESTS'] === '1';

if (!OPTED_OUT && (!TEST_DB_URL || !MIGRATION_URL || !APP_PW)) {
  throw new Error(
    'The tenant-isolation suite cannot reach a database.\n\n' +
      'TEST_DATABASE_URL, TEST_MIGRATION_DATABASE_URL and APP_DB_PASSWORD must all be set ' +
      '(see .env.example).\n\n' +
      'This is a FAILURE, not a skip, on purpose: these 13 tests are the only proof that one ' +
      'tenant cannot read another tenant\'s data. A run that silently omits them is worse than ' +
      'a run that fails, because it reports success. If you genuinely mean to run without a ' +
      'database, set SKIP_DB_TESTS=1 and own that choice.',
  );
}

const describeIfDb = OPTED_OUT ? describe.skip : describe;

let pool: pg.Pool;
let db: Database;         // connects as peoplepulse_app — what the API uses
let single: pg.Pool;      // a ONE-connection pool, to simulate a pooler
let singleDb: Database;
let ownerPool: pg.Pool;
let ownerDb: Database;    // connects as the owner — what the PURGE JOB uses
let acme: string;    // tenant A
let globex: string;  // tenant B

// File-scoped, not per-describe: every block below shares these, so the pools
// must outlive all of them.
beforeAll(async () => {
  if (!TEST_DB_URL || !MIGRATION_URL || !APP_PW) return;

  // Migrate as the OWNER...
  await runMigrations(MIGRATION_URL, APP_PW);

  // ...but test as the APP. RLS does not apply to the owner.
  pool = new pg.Pool({ connectionString: TEST_DB_URL, max: 5 });
  db = drizzle(pool, { schema }) as Database;

  // Fail loudly, before a single assertion runs, if this connection could
  // bypass RLS. A green suite that proves nothing is worse than a red one.
  await assertRlsEnforced(db);

  // max: 1 — every query reuses the SAME physical connection, which is exactly
  // the condition a transaction-mode pooler creates.
  single = new pg.Pool({ connectionString: TEST_DB_URL, max: 1 });
  singleDb = drizzle(single, { schema }) as Database;

  // The account-closure / retention-purge job connects with ELEVATED privileges.
  // The app role holds no DELETE grant on audit_log at all — so purging is not
  // something the API can do even by accident, only a deliberate admin job can.
  ownerPool = new pg.Pool({ connectionString: MIGRATION_URL, max: 2 });
  ownerDb = drizzle(ownerPool, { schema }) as Database;

  // Two companies. Acme's data must be invisible to Globex, and vice versa.
  //
  // Clearing tenants cascades into employee_event and audit_log, which are
  // append-only — so this needs purge mode, exactly as account closure (ADM-05)
  // does. That the test cannot simply delete these rows is the guarantee
  // working, not the guarantee being inconvenient.
  await db.execute(sql`select set_config('app.purge_mode', 'on', false)`);
  await db.delete(tenant);
  await db.execute(sql`select set_config('app.purge_mode', 'off', false)`);

  const [a] = await db.insert(tenant)
    .values({ name: 'Acme Textiles', slug: 'acme', epfRegistered: true })
    .returning({ id: tenant.id });
  const [g] = await db.insert(tenant)
    .values({ name: 'Globex Motors', slug: 'globex', epfRegistered: false })
    .returning({ id: tenant.id });

  acme = a!.id;
  globex = g!.id;

  await withTenant(db, acme, async (tx) => {
    await tx.insert(location).values({ tenantId: acme, name: 'Bengaluru HQ', state: 'KARNATAKA' });
    await tx.insert(employee).values({
      tenantId: acme, empCode: 'ACME-001', firstName: 'Priya', lastName: 'Sharma',
      joinDate: '2026-01-15', status: 'ACTIVE', pfStatus: 'MEMBER',
    });
  });

  await withTenant(db, globex, async (tx) => {
    await tx.insert(location).values({ tenantId: globex, name: 'Pune Plant', state: 'MAHARASHTRA' });
    await tx.insert(employee).values({
      tenantId: globex, empCode: 'GBX-001', firstName: 'Anil', lastName: 'Kumar',
      joinDate: '2026-02-01', status: 'ACTIVE', pfStatus: 'NOT_APPLICABLE',
    });
  });
}, 60_000);

afterAll(async () => {
  await pool?.end();
  await single?.end();
  await ownerPool?.end();
});

describeIfDb('tenant isolation', () => {
  it('shows a tenant only its own employees', async () => {
    const acmeRows = await withTenant(db, acme, (tx) => tx.select().from(employee));
    const globexRows = await withTenant(db, globex, (tx) => tx.select().from(employee));

    expect(acmeRows).toHaveLength(1);
    expect(acmeRows[0]!.firstName).toBe('Priya');

    expect(globexRows).toHaveLength(1);
    expect(globexRows[0]!.firstName).toBe('Anil');
  });

  it('CANNOT read another tenant\'s employee even by its exact primary key', async () => {
    // The attack: Globex has somehow learned the UUID of an Acme employee —
    // from a log, a shared URL, a guess. RLS must make the row not exist.
    const [priya] = await withTenant(db, acme, (tx) =>
      tx.select().from(employee).where(eq(employee.empCode, 'ACME-001')));

    const stolen = await withTenant(db, globex, (tx) =>
      tx.select().from(employee).where(eq(employee.id, priya!.id)));

    expect(stolen).toHaveLength(0); // not "forbidden" — simply not there
  });

  it('CANNOT update another tenant\'s row', async () => {
    const [priya] = await withTenant(db, acme, (tx) =>
      tx.select().from(employee).where(eq(employee.empCode, 'ACME-001')));

    await withTenant(db, globex, (tx) =>
      tx.update(employee).set({ firstName: 'HACKED' }).where(eq(employee.id, priya!.id)));

    const [after] = await withTenant(db, acme, (tx) =>
      tx.select().from(employee).where(eq(employee.id, priya!.id)));

    expect(after!.firstName).toBe('Priya'); // untouched
  });

  it('CANNOT delete another tenant\'s row', async () => {
    const [anil] = await withTenant(db, globex, (tx) =>
      tx.select().from(employee).where(eq(employee.empCode, 'GBX-001')));

    await withTenant(db, acme, (tx) =>
      tx.delete(employee).where(eq(employee.id, anil!.id)));

    const stillThere = await withTenant(db, globex, (tx) =>
      tx.select().from(employee).where(eq(employee.id, anil!.id)));

    expect(stillThere).toHaveLength(1); // survived
  });

  it('CANNOT insert a row belonging to another tenant', async () => {
    // WITH CHECK guards this. Without it, a caller could write a row that is
    // invisible to them but visible to the victim — arguably worse than a leak.
    await expect(
      withTenant(db, globex, (tx) =>
        tx.insert(employee).values({
          tenantId: acme,                    // <-- lying about the owner
          empCode: 'SMUGGLED-001', firstName: 'Mallory',
          joinDate: '2026-03-01',
        })),
    ).rejects.toThrow(/row-level security/i);
  });

  it('returns ZERO rows when no tenant context is set — fails closed', async () => {
    // The most important test here. If tenant context is missing, the correct
    // failure is to see NOTHING, never EVERYTHING. current_setting(...) is NULL,
    // `tenant_id = NULL` is NULL, which is not TRUE, so no row matches.
    const rows = await db.select().from(employee);
    expect(rows).toHaveLength(0);
  });
});

/**
 * ============================================================================
 * THE POOLER TEST (ADR-005 D-2)
 * ============================================================================
 *
 * This is the test that would have caught the bug in TRD TR-01.
 *
 * TR-01 said to set tenant context on the SESSION. Under a transaction-mode
 * pooler, a physical connection is returned to the pool at COMMIT — so a
 * session-scoped setting outlives the request that set it and is inherited by
 * whichever request grabs that connection next. Which may be a different
 * company.
 *
 * A pool of ONE connection, forced to serve two tenants back to back, is the
 * cheapest possible reproduction: if context leaks, the second tenant sees the
 * first tenant's rows.
 */
describeIfDb('tenant context does not leak across a recycled connection', () => {
  it('does not carry tenant A\'s context into tenant B\'s next request', async () => {
    const acmeRows = await withTenant(singleDb, acme, (tx) => tx.select().from(employee));
    expect(acmeRows.map((e) => e.empCode)).toEqual(['ACME-001']);

    // Same connection, immediately reused. With a session-scoped SET, this
    // would still be Acme — and would silently return Acme's employees.
    const globexRows = await withTenant(singleDb, globex, (tx) => tx.select().from(employee));
    expect(globexRows.map((e) => e.empCode)).toEqual(['GBX-001']);

    // And back again.
    const acmeAgain = await withTenant(singleDb, acme, (tx) => tx.select().from(employee));
    expect(acmeAgain.map((e) => e.empCode)).toEqual(['ACME-001']);
  });

  it('discards tenant context at COMMIT, leaving the connection clean', async () => {
    await withTenant(singleDb, acme, async (tx) => {
      const [ctx] = (await tx.execute<{ t: string | null }>(
        sql`select current_setting('app.current_tenant', true) as t`,
      )).rows;
      expect(ctx!.t).toBe(acme); // set inside the transaction
    });

    // After COMMIT, on the very same pooled connection, it must be gone.
    const [after] = (await singleDb.execute<{ t: string | null }>(
      sql`select current_setting('app.current_tenant', true) as t`,
    )).rows;

    expect(after!.t).toBeFalsy(); // '' or null — NOT the acme id
  });

  it('leaves no context behind even when the transaction ROLLS BACK', async () => {
    await expect(
      withTenant(singleDb, acme, async (tx) => {
        await tx.select().from(employee);
        throw new Error('boom'); // force a rollback
      }),
    ).rejects.toThrow('boom');

    const [after] = (await singleDb.execute<{ t: string | null }>(
      sql`select current_setting('app.current_tenant', true) as t`,
    )).rows;

    expect(after!.t).toBeFalsy();
  });
});

describeIfDb('append-only guarantees (NFR-08, CHR-07)', () => {
  /**
   * TWO INDEPENDENT LOCKS, and the app hits the first one.
   *
   *   1. GRANT — peoplepulse_app simply holds no UPDATE/DELETE privilege on
   *      these tables, so Postgres refuses with "permission denied" before any
   *      trigger runs.
   *   2. TRIGGER — fires even for a role that DOES hold the grant (the owner,
   *      a migration, a superuser at a psql prompt), and refuses unless purge
   *      mode is explicitly on.
   *
   * Either rejection is a pass. Matching only the trigger's message would have
   * made this test fail while the system was MORE secure than expected — which
   * is exactly what happened on the first run.
   */
  const REFUSED = /permission denied|append-only|immutable/i;

  it('refuses to UPDATE the audit log', async () => {
    await withTenant(db, acme, async (tx) => {
      await tx.execute(sql`
        insert into audit_log (tenant_id, entity, action)
        values (${acme}, 'employee', 'CREATE')
      `);
    });

    await expect(
      withTenant(db, acme, (tx) =>
        tx.execute(sql`update audit_log set action = 'TAMPERED' where tenant_id = ${acme}`)),
    ).rejects.toThrow(REFUSED);
  });

  it('refuses to DELETE from the audit log', async () => {
    await expect(
      withTenant(db, acme, (tx) =>
        tx.execute(sql`delete from audit_log where tenant_id = ${acme}`)),
    ).rejects.toThrow(REFUSED);

    // ...and the row is still there.
    const [{ count }] = (await withTenant(db, acme, (tx) =>
      tx.execute<{ count: string }>(sql`select count(*) as count from audit_log`))).rows;
    expect(Number(count)).toBeGreaterThan(0);
  });

  it('refuses to rewrite employee history', async () => {
    const [priya] = await withTenant(db, acme, (tx) =>
      tx.select().from(employee).where(eq(employee.empCode, 'ACME-001')));

    await withTenant(db, acme, (tx) =>
      tx.execute(sql`
        insert into employee_event (tenant_id, employee_id, type, effective_date)
        values (${acme}, ${priya!.id}, 'JOIN', '2026-01-15')
      `));

    // A promotion recorded in error is corrected by a NEW event, never by
    // editing the old one. That is what makes "what was their designation in
    // March?" answerable at all.
    await expect(
      withTenant(db, acme, (tx) =>
        tx.execute(sql`update employee_event set type = 'PROMOTION' where tenant_id = ${acme}`)),
    ).rejects.toThrow(REFUSED);
  });

  it('DOES allow erasure in purge mode — account closure must work (ADM-05)', async () => {
    // Append-only cannot mean immortal. DPDP grants an erasure right, and a
    // departing customer's data must actually go once retention expires.
    // Purge mode is the one sanctioned door, and it is deliberately awkward.
    const before = (await withTenant(db, acme, (tx) =>
      tx.execute<{ count: string }>(sql`select count(*) as count from audit_log`))).rows[0]!;
    expect(Number(before.count)).toBeGreaterThan(0);

    // Note this runs on ownerDb, NOT db. The app role cannot reach these rows
    // even with purge mode on — it holds no DELETE grant. Purging is an admin
    // job with elevated privileges, and cannot be triggered from the API.
    await withPurgeMode(ownerDb, acme, 'test: account closure (ADM-05)', async (tx) => {
      await tx.execute(sql`delete from audit_log where tenant_id = ${acme}`);
    });

    const after = (await withTenant(db, acme, (tx) =>
      tx.execute<{ count: string }>(sql`select count(*) as count from audit_log`))).rows[0]!;
    expect(Number(after.count)).toBe(0);
  });
});
