import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { and, eq, sql } from 'drizzle-orm';
import {
  getDb, closeDb, withTenant, withPurgeMode, assertRlsEnforced,
  tenant, location, employee, leaveTxn,
  type Database, type Employee,
} from '@peoplepulse/db';
import {
  leaveYearOf, toIstDate,
  type Actor, type CreateEmployeeInput, type Permission,
} from '@peoplepulse/core';
import { AuditService } from '../../platform/audit/audit.service';
import { PiiService } from '../../platform/crypto/pii.service';
import { EmployeeService } from '../employee/employee.service';
import { LeaveService } from './leave.service';
import { LeaveLedgerService } from './leave-ledger.service';
import { LeavePolicyService } from './leave-policy.service';
import { LeaveYearEndService } from './leave-year-end.service';

/**
 * Closing a leave year (LVE-02, D-25), against a real database.
 *
 * A close touches every employee in a company, so this suite has companies of
 * its own rather than sharing leave.service.test.ts's: closing 2025 there would
 * post and carry balances that suite asserts on.
 *
 * Every test closes 2025, which has ended whenever this runs. Closes are
 * re-runnable, so each test's close also passes over earlier tests' people —
 * assertions are about the test's own people only.
 */
const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const OPTED_OUT = process.env['SKIP_DB_TESTS'] === '1';

if (!OPTED_OUT && !TEST_DB_URL) {
  throw new Error(
    'The year-end suite cannot reach a database. Set TEST_DATABASE_URL (see .env.example), '
      + 'or SKIP_DB_TESTS=1 if you mean to run without one.',
  );
}

const describeIfDb = OPTED_OUT ? describe.skip : describe;

const EMPLOYEE: Permission[] = ['leave.apply', 'leave.view.own', 'employee.view'];
const HR: Permission[] = [
  ...EMPLOYEE, 'leave.view.team', 'leave.approve', 'leave.view.all', 'leave.manage',
  'employee.view.all', 'employee.create', 'employee.edit',
];

const pii = new PiiService({ getOrThrow: () => 'test-only-pii-key' } as unknown as ConfigService);

let db: Database;
let leave: LeaveService;
let ledger: LeaveLedgerService;
let policy: LeavePolicyService;
let yearEnd: LeaveYearEndService;
let employees: EmployeeService;

let initech: string;
let hooli: string;
let bengaluru: string;
let hrPerson: Employee;
const typeIds = new Map<string, string>();

function actorIn(tenantId: string, permissions: Permission[], employeeId: string | null): Actor {
  return { userId: randomUUID(), tenantId, employeeId, permissions: new Set(permissions), mfaVerified: true };
}

const hr = () => actorIn(initech, HR, hrPerson.id);
/** HR with no employee record — the founder — for opening balances, which nobody may enter for themselves. */
const admin = (tenantId = initech) => actorIn(tenantId, HR, null);
const as = (person: Employee) => actorIn(person.tenantId, EMPLOYEE, person.id);

function hire(input: Partial<CreateEmployeeInput> = {}, tenantId = initech): Promise<Employee> {
  return employees.create(admin(tenantId), {
    empCode: `E-${randomUUID().slice(0, 8)}`,
    firstName: 'Priya',
    joinDate: '2025-01-01',
    employmentType: 'FULL_TIME',
    hasPriorPfMembership: false,
    locationId: tenantId === initech ? bengaluru : undefined,
    ...input,
  });
}

function type(code: string, tenantId = initech): string {
  const id = typeIds.get(`${tenantId}:${code}`);
  if (!id) throw new Error(`no ${code} leave type in ${tenantId}`);
  return id;
}

async function give(person: Employee, days: number, code = 'YE', calendarYear = 2025, kind: 'OPENING' | 'ADJUSTMENT' = 'OPENING') {
  await ledger.adjust(admin(person.tenantId), {
    employeeId: person.id, leaveTypeId: type(code, person.tenantId), calendarYear, kind, days,
    reason: 'test balance',
  });
}

async function balance(person: Employee, code: string, year: number): Promise<number | null> {
  const rows = await ledger.balances(admin(person.tenantId), person.id, year);
  return rows.find((r) => r.leaveType.code === code)?.balanceDays ?? null;
}

/** [kind, days] for one person's entries of one type in one year, in the order they were written. */
async function entries(person: Employee, code: string, year: number) {
  const rows = await ledger.ledger(admin(person.tenantId), person.id, year);
  return rows.filter((r) => r.leaveType.code === code).map((r) => [r.kind, r.days]);
}

function rowsOf(person: Employee) {
  return withTenant(db, person.tenantId, (tx) => tx.select().from(leaveTxn).where(eq(leaveTxn.employeeId, person.id)));
}

const close = (year = 2025) => yearEnd.close(hr(), { year });

async function refusal(attempt: Promise<unknown>): Promise<{ status: number; code?: string; fields?: string[] }> {
  const error = await attempt.then(() => null, (e: unknown) => e);
  if (!(error instanceof HttpException)) throw new Error(`expected a refusal, got ${String(error)}`);
  const body = error.getResponse() as { code?: string; errors?: { field: string }[] };
  return {
    status: error.getStatus(),
    ...(body.code && { code: body.code }),
    ...(body.errors && { fields: body.errors.map((e) => e.field) }),
  };
}

/** Open connections before a race, so the racers really overlap (see leave.service.test.ts). */
async function warmPool(connections: number) {
  await Promise.all(Array.from({ length: connections }, () => db.execute(sql`select pg_sleep(0.05)`)));
}

beforeAll(async () => {
  if (!TEST_DB_URL) return;

  db = getDb(TEST_DB_URL);
  await assertRlsEnforced(db);

  const audit = new AuditService(db);
  leave = new LeaveService(db, audit);
  ledger = new LeaveLedgerService(db, audit);
  policy = new LeavePolicyService(db, audit);
  yearEnd = new LeaveYearEndService(db, audit);
  employees = new EmployeeService(db, audit, pii);

  const suffix = randomUUID().slice(0, 8);
  const [i] = await db.insert(tenant).values({ name: 'Initech Looms', slug: `initech-ye-${suffix}` }).returning();
  const [h] = await db.insert(tenant).values({ name: 'Hooli Dyes', slug: `hooli-ye-${suffix}` }).returning();
  initech = i!.id;
  hooli = h!.id;

  await withTenant(db, initech, async (tx) => {
    const [b] = await tx.insert(location).values({ tenantId: initech, name: 'Bengaluru', state: 'KARNATAKA' }).returning();
    bengaluru = b!.id;
  });

  for (const tenantId of [initech, hooli]) {
    await policy.updateSettings(admin(tenantId), { weeklyOffDays: [0, 6] });
    for (const t of await policy.addDefaultTypes(admin(tenantId))) typeIds.set(`${tenantId}:${t.code}`, t.id);
  }

  // A type that earns nothing on its own, so a test's balance is exactly what it gives —
  // with both limits, so one close shows all three outcomes.
  const ye = await policy.createType(admin(), {
    code: 'YE', name: 'Year-end test', isPaid: true, accrualFrequency: 'NONE', annualEntitlementDays: 0,
    allowsHalfDay: true, proRataOnJoin: false, dayCountBasis: 'WORKING_DAYS',
    carryForwardMaxDays: 5, encashMaxDays: 2,
  });
  typeIds.set(`${initech}:YE`, ye.id);

  hrPerson = await hire({ firstName: 'Meena' });
});

afterAll(async () => {
  for (const id of [initech, hooli]) {
    if (id) {
      await withPurgeMode(db, id, 'year-end test teardown', (tx) => tx.delete(tenant).where(eq(tenant.id, id)));
    }
  }
  await closeDb();
});

describeIfDb('closing a leave year', () => {
  it('carries up to the limit, encashes the next part, lapses the rest — and the new year opens with what carried', async () => {
    const priya = await hire();
    await give(priya, 10);

    await close();

    expect(await entries(priya, 'YE', 2025)).toEqual([
      ['OPENING', 10], ['CARRY_OUT', -5], ['ENCASHMENT', -2], ['LAPSE', -3],
    ]);
    expect(await entries(priya, 'YE', 2026)).toEqual([['CARRY_IN', 5]]);
    expect(await balance(priya, 'YE', 2025)).toBe(0);
    expect(await balance(priya, 'YE', 2026)).toBe(5);

    // The rule that did it is kept with each entry, so the history answers "why".
    const history = await ledger.ledger(as(priya), priya.id, 2025);
    expect(history.find((e) => e.kind === 'LAPSE' && e.leaveType.code === 'YE')?.reason)
      .toBe('2025 year end: Year-end test carries up to 5 days, encashes up to 2 days');
  });

  it('posts the year\'s missing credits first, so December\'s earned leave is not left behind', async () => {
    const ravi = await hire();

    const result = await close();

    expect(result.creditsPosted).toBeGreaterThan(0);
    // Earned leave carries in full by default: all fifteen days, December's included.
    expect(await balance(ravi, 'EL', 2025)).toBe(0);
    expect(await balance(ravi, 'EL', 2026)).toBe(15);
    // Casual leave lapses by default.
    expect(await entries(ravi, 'CL', 2025)).toEqual([['GRANT', 12], ['LAPSE', -12]]);
    expect(await balance(ravi, 'CL', 2026)).toBe(0);
  });

  it('moves nothing when closed again — and sweeps what arrives later, within the room the limits have left', async () => {
    const asha = await hire();
    await give(asha, 10);
    await close();

    await close();
    expect(await entries(asha, 'YE', 2025)).toHaveLength(4);

    // A late correction to the old year. Carry (5 of 5) and encashment (2 of 2)
    // are used up, so all of it lapses — the limits are for the year, not per close.
    await give(asha, 3, 'YE', 2025, 'ADJUSTMENT');
    await close();

    expect(await balance(asha, 'YE', 2025)).toBe(0);
    expect(await balance(asha, 'YE', 2026)).toBe(5);
    expect((await entries(asha, 'YE', 2025)).slice(4)).toEqual([['ADJUSTMENT', 3], ['LAPSE', -3]]);
  });

  it('leaves alone a balance with leave still waiting for a decision, says whose, and closes it once decided', async () => {
    const kabir = await hire({ firstName: 'Kabir' });
    await give(kabir, 4);
    const request = await leave.apply(as(kabir), {
      leaveTypeId: type('YE'), startDate: '2025-12-15', endDate: '2025-12-15', startSession: 'FIRST', endSession: 'SECOND',
    });

    const first = await close();

    expect(first.skipped.filter((s) => s.employee.id === kabir.id)).toEqual([expect.objectContaining({
      reason: 'PENDING_REQUESTS', balanceDays: 4, pendingDays: 1, leaveType: expect.objectContaining({ code: 'YE' }),
    })]);
    expect(await balance(kabir, 'YE', 2025)).toBe(4);
    // Only the type with the pending request waits: the rest of Kabir's leave closed.
    expect(await balance(kabir, 'EL', 2026)).toBe(15);

    await leave.decide(hr(), request.id, { decision: 'APPROVE' });
    const second = await close();

    expect(second.skipped.some((s) => s.employee.id === kabir.id)).toBe(false);
    expect(await balance(kabir, 'YE', 2026)).toBe(3);
  });

  it('leaves the balance of someone who left during the year for full-and-final settlement', async () => {
    const leaver = await hire();
    await give(leaver, 6);
    await withTenant(db, initech, (tx) =>
      tx.update(employee).set({ exitDate: '2025-10-31' }).where(eq(employee.id, leaver.id)));

    const result = await close();

    expect(result.skipped.find((s) => s.employee.id === leaver.id && s.leaveType.code === 'YE'))
      .toMatchObject({ reason: 'EXITED', balanceDays: 6 });
    expect(await balance(leaver, 'YE', 2025)).toBe(6);
    expect(await entries(leaver, 'YE', 2026)).toEqual([]);
  });

  it('reports an overdrawn balance rather than carrying the deficit into the new year', async () => {
    const over = await hire();
    await give(over, -2);

    const result = await close();

    expect(result.skipped.find((s) => s.employee.id === over.id))
      .toMatchObject({ reason: 'OVERDRAWN', balanceDays: -2 });
    expect(await balance(over, 'YE', 2025)).toBe(-2);
    expect(await balance(over, 'YE', 2026)).toBe(0);
  });

  it('previews exactly what the close then does, and writes nothing', async () => {
    const dev = await hire();
    await give(dev, 7);
    const before = await rowsOf(dev);

    const preview = await yearEnd.preview(hr(), { year: 2025 });

    expect(preview.dryRun).toBe(true);
    expect(await rowsOf(dev)).toHaveLength(before.length);

    const closed = await close();
    expect(closed.dryRun).toBe(false);
    expect({ ...closed, dryRun: true }).toEqual(preview);
    expect(preview.types.find((t) => t.leaveType.code === 'YE')).toMatchObject({
      carryForwardMaxDays: 5, encashMaxDays: 2,
    });
  });

  it('will not close a year that has not ended, but will preview it', async () => {
    const year = leaveYearOf(toIstDate(new Date()));

    expect(await refusal(yearEnd.close(hr(), { year }))).toMatchObject({ status: 400, fields: ['year'] });
    expect((await yearEnd.preview(hr(), { year })).yearEnded).toBe(false);
    expect(await refusal(yearEnd.preview(hr(), { year: year + 1 }))).toMatchObject({ status: 400, fields: ['year'] });
  });

  it('carries once when two closes run at once', async () => {
    const tara = await hire();
    await give(tara, 4);
    // Credits already posted, so neither close has an accrual row to queue on:
    // only the employee lock stands between them.
    await ledger.postAccruals(admin(), { through: '2025-12' });
    await warmPool(4);

    await Promise.all([close(), close()]);

    expect(await balance(tara, 'YE', 2026)).toBe(4);
    expect(await entries(tara, 'YE', 2026)).toEqual([['CARRY_IN', 4]]);
  });

  it('needs the company-wide view of leave — a team-scoped admin cannot read every balance through it', async () => {
    const scoped = actorIn(initech, ['leave.manage', 'leave.view.team', 'leave.approve'], null);

    expect(await refusal(yearEnd.preview(scoped, { year: 2025 })))
      .toMatchObject({ status: 403, code: 'NEEDS_LEAVE_VIEW_ALL' });
    expect(await refusal(yearEnd.close(scoped, { year: 2025 })))
      .toMatchObject({ status: 403, code: 'NEEDS_LEAVE_VIEW_ALL' });
  });

  it('moves nothing in another company', async () => {
    const elsewhere = await hire({}, hooli);
    await give(elsewhere, 9, 'CL');

    await close();

    const rows = await withTenant(db, hooli, (tx) => tx.select({ kind: leaveTxn.kind }).from(leaveTxn)
      .where(and(eq(leaveTxn.employeeId, elsewhere.id), eq(leaveTxn.leaveTypeId, type('CL', hooli)))));
    expect(rows.map((r) => r.kind)).toEqual(['OPENING']);
  });
});

describeIfDb('year-end rules on a leave type', () => {
  it('keeps the rules it is given, and changes them', async () => {
    const created = await policy.createType(admin(), {
      code: 'CO', name: 'Comp off', isPaid: true, accrualFrequency: 'NONE', annualEntitlementDays: 0,
      allowsHalfDay: true, proRataOnJoin: false, dayCountBasis: 'WORKING_DAYS',
      carryForwardMaxDays: 0, encashMaxDays: 3.5,
    });
    expect(created).toMatchObject({ carryForwardMaxDays: 0, encashMaxDays: 3.5 });

    const updated = await policy.updateType(admin(), created.id, { carryForwardMaxDays: null });
    expect(updated).toMatchObject({ carryForwardMaxDays: null, encashMaxDays: 3.5 });
  });

  it('gives a new company\'s casual and sick leave no carry, and earned leave all of it', async () => {
    const types = await policy.listTypes(admin(hooli));
    const byCode = Object.fromEntries(types.map((t) => [t.code, t.carryForwardMaxDays]));
    expect(byCode).toMatchObject({ CL: 0, SL: 0, EL: null, ML: null });
  });

  it('will not encash unpaid leave — it has no balance', async () => {
    expect(await refusal(policy.updateType(admin(), type('LOP'), { encashMaxDays: 1 })))
      .toMatchObject({ status: 400, fields: ['encashMaxDays'] });
  });
});
