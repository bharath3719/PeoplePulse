import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import {
  getDb, closeDb, withTenant, withPurgeMode, assertRlsEnforced,
  tenant, user, location, punchEvent, rosterAssignment, shift,
  type Database, type Employee,
} from '@peoplepulse/db';
import {
  type Actor, type CreateEmployeeInput, type Permission,
} from '@peoplepulse/core';
import { AuditService } from '../../platform/audit/audit.service';
import { PiiService } from '../../platform/crypto/pii.service';
import { EmployeeService } from '../employee/employee.service';
import { TenantService } from '../tenant/tenant.service';
import { LeaveService } from '../leave/leave.service';
import { LeaveLedgerService } from '../leave/leave-ledger.service';
import { LeavePolicyService } from '../leave/leave-policy.service';
import { ShiftService } from './shift.service';
import { RosterService } from './roster.service';
import { PunchService } from './punch.service';

/**
 * Attendance — shifts, rosters, punches — against a real database.
 *
 * Real, because what goes wrong here goes wrong between transactions or across
 * midnight: two clicks that each see "not punched in", a night shift's
 * punch-out filed under the wrong day, a punch someone tries to rewrite, a
 * roster that makes leave and attendance disagree about a day off. Each test
 * tries to get one of those through.
 *
 * Like every DB-backed suite here, this FAILS without a database rather than
 * skipping. SKIP_DB_TESTS=1 opts out, out loud.
 */
const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const OPTED_OUT = process.env['SKIP_DB_TESTS'] === '1';

if (!OPTED_OUT && !TEST_DB_URL) {
  throw new Error(
    'The attendance suite cannot reach a database. Set TEST_DATABASE_URL (see .env.example), '
      + 'or SKIP_DB_TESTS=1 if you mean to run without one.',
  );
}

const describeIfDb = OPTED_OUT ? describe.skip : describe;

const EMPLOYEE: Permission[] = [
  'attendance.punch', 'attendance.view.own', 'leave.apply', 'leave.view.own', 'employee.view',
];
const MANAGER: Permission[] = [...EMPLOYEE, 'attendance.view.team', 'attendance.approve'];
const HR: Permission[] = [
  ...MANAGER, 'attendance.view.all', 'attendance.manage', 'leave.view.all', 'leave.manage',
  'employee.view.all', 'employee.create', 'employee.edit', 'employee.delete',
];

const pii = new PiiService({ getOrThrow: () => 'test-only-pii-key' } as unknown as ConfigService);

let db: Database;
let shifts: ShiftService;
let rosters: RosterService;
let punches: PunchService;
let employees: EmployeeService;
let leave: LeaveService;
let ledger: LeaveLedgerService;
let policy: LeavePolicyService;

/** What time the punch service thinks it is. Real time unless a test moves it. */
let now: Date | null = null;

let acme: string;
let globex: string;
let bengaluru: string;
let hrPerson: Employee;
let generalShift: string; // Acme's default
let nightShift: string;
let globexShift: string;

function actorIn(tenantId: string, permissions: Permission[], employeeId: string | null): Actor {
  return { userId: randomUUID(), tenantId, employeeId, permissions: new Set(permissions), mfaVerified: true };
}

const hr = () => actorIn(acme, HR, hrPerson.id);
const as = (person: Employee, permissions: Permission[] = EMPLOYEE) => actorIn(person.tenantId, permissions, person.id);

/** An instant, written as IST wall-clock time: '2026-07-13 22:00'. */
function ist(wallClock: string): Date {
  return new Date(`${wallClock.replace(' ', 'T')}:00+05:30`);
}

function hire(tenantId: string, input: Partial<CreateEmployeeInput> = {}): Promise<Employee> {
  return employees.create(actorIn(tenantId, HR, null), {
    empCode: `E-${randomUUID().slice(0, 8)}`,
    firstName: 'Ravi',
    joinDate: '2026-01-01',
    employmentType: 'FULL_TIME',
    hasPriorPfMembership: false,
    locationId: tenantId === acme ? bengaluru : undefined,
    ...input,
  });
}

/** The machine-readable code a 403/409 carried — what the UI keys its message on. */
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

/** See leave.service.test.ts: without warm connections, a "race" runs one at a time and proves nothing. */
async function warmPool(connections: number) {
  await Promise.all(Array.from({ length: connections }, () => db.execute(sql`select pg_sleep(0.05)`)));
}

function punchRows(person: Employee) {
  return withTenant(db, person.tenantId, (tx) => tx.select().from(punchEvent).where(eq(punchEvent.employeeId, person.id)));
}

beforeAll(async () => {
  if (!TEST_DB_URL) return;

  db = getDb(TEST_DB_URL);
  await assertRlsEnforced(db);

  const audit = new AuditService(db);
  shifts = new ShiftService(db, audit);
  rosters = new RosterService(db, audit);
  punches = new PunchService(db, () => now ?? new Date());
  employees = new EmployeeService(db, audit, pii);
  leave = new LeaveService(db, audit);
  ledger = new LeaveLedgerService(db, audit);
  policy = new LeavePolicyService(db, audit);

  const suffix = randomUUID().slice(0, 8);
  const [a] = await db.insert(tenant).values({ name: 'Acme Textiles', slug: `acme-att-${suffix}` }).returning();
  const [g] = await db.insert(tenant).values({ name: 'Globex Motors', slug: `globex-att-${suffix}` }).returning();
  acme = a!.id;
  globex = g!.id;

  await withTenant(db, acme, async (tx) => {
    const [b] = await tx.insert(location).values({ tenantId: acme, name: 'Bengaluru', state: 'KARNATAKA' }).returning();
    bengaluru = b!.id;
  });

  hrPerson = await hire(acme, { firstName: 'Meena' });
  generalShift = (await shifts.create(hr(), { code: 'GEN', name: 'General', startTime: '09:30', endTime: '18:30', graceMinutes: 15 })).id;
  nightShift = (await shifts.create(hr(), { code: 'NIGHT', name: 'Night', startTime: '22:00', endTime: '06:00', graceMinutes: 15 })).id;
  globexShift = (await shifts.create(actorIn(globex, HR, null), {
    code: 'GEN', name: 'General', startTime: '09:00', endTime: '18:00', graceMinutes: 10,
  })).id;
});

afterAll(async () => {
  for (const id of [acme, globex]) {
    if (id) {
      await withPurgeMode(db, id, 'attendance test teardown', (tx) => tx.delete(tenant).where(eq(tenant.id, id)));
    }
  }
  await closeDb();
});

describeIfDb('shifts', () => {
  it('makes a company\'s first shift its default, and keeps to one default', async () => {
    const list = await shifts.list(hr());
    expect(list.filter((s) => s.isDefault).map((s) => s.code)).toEqual(['GEN']);
    expect(list.find((s) => s.code === 'NIGHT')).toMatchObject({ crossesMidnight: true, lengthMinutes: 480, isDefault: false });

    await shifts.makeDefault(hr(), nightShift);
    expect((await shifts.list(hr())).filter((s) => s.isDefault).map((s) => s.code)).toEqual(['NIGHT']);
    await shifts.makeDefault(hr(), generalShift);
    expect((await shifts.list(hr())).filter((s) => s.isDefault).map((s) => s.code)).toEqual(['GEN']);
  });

  it('will not switch off the default shift, or make a switched-off one the default', async () => {
    expect(await refusal(shifts.update(hr(), generalShift, { isActive: false })))
      .toMatchObject({ status: 409, code: 'DEFAULT_SHIFT' });

    const spare = await shifts.create(hr(), { code: `S${randomUUID().slice(0, 4).toUpperCase()}`, name: 'Spare', startTime: '07:00', endTime: '15:00', graceMinutes: 0 });
    await shifts.update(hr(), spare.id, { isActive: false });
    expect(await refusal(shifts.makeDefault(hr(), spare.id))).toMatchObject({ status: 409, code: 'SHIFT_INACTIVE' });
  });

  it('refuses a duplicate code, and a change that would end a shift when it starts', async () => {
    expect(await refusal(shifts.create(hr(), { code: 'GEN', name: 'Again', startTime: '08:00', endTime: '17:00', graceMinutes: 15 })))
      .toMatchObject({ status: 400, fields: ['code'] });
    // Only one time sent: the check has to be against the shift as it will be.
    expect(await refusal(shifts.update(hr(), nightShift, { startTime: '06:00' })))
      .toMatchObject({ status: 400, fields: ['endTime'] });
  });

  it('keeps each company\'s shifts to itself', async () => {
    const globexCodes = (await shifts.list(actorIn(globex, HR, null))).map((s) => s.id);
    expect(globexCodes).toEqual([globexShift]);
    expect(await refusal(shifts.update(actorIn(globex, HR, null), generalShift, { name: 'Mine now' })))
      .toMatchObject({ status: 404 });
  });
});

describeIfDb('rosters', () => {
  it('applies the latest entry on or before a date, and the company default before the first', async () => {
    const ravi = await hire(acme);
    const fresh = await rosters.forEmployee(hr(), ravi.id);
    expect(fresh.current).toMatchObject({ from: 'COMPANY', shift: { code: 'GEN' } });
    expect(fresh.canManage).toBe(true);

    await rosters.assign(hr(), { employeeId: ravi.id, shiftId: nightShift, effectiveFrom: '2026-02-02', weeklyOffDays: [0] });
    await rosters.assign(hr(), { employeeId: ravi.id, shiftId: generalShift, effectiveFrom: '2099-01-05', weeklyOffDays: [0, 6] });

    const view = await rosters.forEmployee(hr(), ravi.id);
    expect(view.current).toMatchObject({ from: 'ROSTER', shift: { code: 'NIGHT' }, weeklyOffDays: [0] });
    expect(view.entries.map((e) => e.effectiveFrom)).toEqual(['2099-01-05', '2026-02-02']);
  });

  it('replaces an entry on the same date rather than stacking a second', async () => {
    const ravi = await hire(acme);
    await rosters.assign(hr(), { employeeId: ravi.id, shiftId: nightShift, effectiveFrom: '2026-03-02', weeklyOffDays: [0] });
    await rosters.assign(hr(), { employeeId: ravi.id, shiftId: generalShift, effectiveFrom: '2026-03-02', weeklyOffDays: [2, 3] });

    const { entries } = await rosters.forEmployee(hr(), ravi.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ shift: { code: 'GEN' }, weeklyOffDays: [2, 3] });

    await rosters.remove(hr(), entries[0]!.id);
    expect((await rosters.forEmployee(hr(), ravi.id)).entries).toHaveLength(0);
  });

  it('will not let anyone change their own roster — a weekly off moved onto a missed day is pay', async () => {
    expect(await refusal(rosters.assign(hr(), {
      employeeId: hrPerson.id, shiftId: generalShift, effectiveFrom: '2026-04-01', weeklyOffDays: [0, 1],
    }))).toMatchObject({ status: 403, code: 'OWN_ROSTER' });
    expect((await rosters.forEmployee(hr(), hrPerson.id)).canManage).toBe(false);
  });

  it('will not roster anyone onto another company\'s shift — the foreign key would let it', async () => {
    const ravi = await hire(acme);
    expect(await refusal(rosters.assign(hr(), {
      employeeId: ravi.id, shiftId: globexShift, effectiveFrom: '2026-04-01', weeklyOffDays: [0],
    }))).toMatchObject({ status: 400, fields: ['shiftId'] });
  });

  it('refuses a switched-off shift, and a start before they joined', async () => {
    const ravi = await hire(acme, { joinDate: '2026-05-01' });
    const old = await shifts.create(hr(), { code: `O${randomUUID().slice(0, 4).toUpperCase()}`, name: 'Old', startTime: '06:00', endTime: '14:00', graceMinutes: 0 });
    await shifts.update(hr(), old.id, { isActive: false });

    expect(await refusal(rosters.assign(hr(), { employeeId: ravi.id, shiftId: old.id, effectiveFrom: '2026-05-04', weeklyOffDays: [0] })))
      .toMatchObject({ status: 400, fields: ['shiftId'] });
    expect(await refusal(rosters.assign(hr(), { employeeId: ravi.id, shiftId: generalShift, effectiveFrom: '2026-04-27', weeklyOffDays: [0] })))
      .toMatchObject({ status: 400, fields: ['effectiveFrom'] });
  });

  it('is a 404 to another company, and to a colleague who is not your report', async () => {
    const ravi = await hire(acme);
    const colleague = await hire(acme);
    expect(await refusal(rosters.forEmployee(actorIn(globex, HR, null), ravi.id))).toMatchObject({ status: 404 });
    expect(await refusal(rosters.assign(actorIn(globex, HR, null), {
      employeeId: ravi.id, shiftId: globexShift, effectiveFrom: '2026-04-01', weeklyOffDays: [0],
    }))).toMatchObject({ status: 404 });
    expect(await refusal(rosters.forEmployee(as(colleague), ravi.id))).toMatchObject({ status: 404 });
    expect((await rosters.forEmployee(as(ravi), ravi.id)).canManage).toBe(false);
  });

  it('moves leave\'s weekly offs with it, so leave and attendance agree on a day off', async () => {
    const ravi = await hire(acme);
    await rosters.assign(hr(), { employeeId: ravi.id, shiftId: generalShift, effectiveFrom: '2026-01-01', weeklyOffDays: [2, 3] });
    const [cl] = (await policy.addDefaultTypes(hr())).filter((t) => t.code === 'CL');
    const clId = cl?.id ?? (await policy.listTypes(hr())).find((t) => t.code === 'CL')!.id;
    await ledger.adjust(actorIn(acme, HR, null), {
      employeeId: ravi.id, leaveTypeId: clId, calendarYear: 2026, kind: 'OPENING', days: 10, reason: 'test balance',
    });

    // Mon 7 Dec to Sun 13 Dec 2026. The company is off on Sundays; Ravi is off
    // Tuesday and Wednesday instead, and works the Sunday.
    const preview = await leave.preview(as(ravi), {
      leaveTypeId: clId, startDate: '2026-12-07', startSession: 'FIRST', endDate: '2026-12-13', endSession: 'SECOND',
    });
    expect(preview.days).toBe(5);

    const days = await punches.days(as(ravi), ravi.id, { from: '2026-12-07', to: '2026-12-13' });
    expect(days.filter((d) => d.weeklyOff).map((d) => d.date).sort()).toEqual(['2026-12-08', '2026-12-09']);
  });
});

describeIfDb('punching in and out', () => {
  it('goes in, then out, and refuses either twice in a row', async () => {
    const ravi = await hire(acme);
    expect((await punches.status(as(ravi))).next).toBe('IN');
    expect(await refusal(punches.punch(as(ravi), { direction: 'OUT' }))).toMatchObject({ status: 409, code: 'NOT_PUNCHED_IN' });

    const afterIn = await punches.punch(as(ravi), { direction: 'IN' });
    expect(afterIn.next).toBe('OUT');
    expect(afterIn.today.punches.map((p) => p.direction)).toEqual(['IN']);
    expect(await refusal(punches.punch(as(ravi), { direction: 'IN' }))).toMatchObject({ status: 409, code: 'ALREADY_PUNCHED_IN' });

    const afterOut = await punches.punch(as(ravi), { direction: 'OUT' });
    expect(afterOut.next).toBe('IN');
    expect((await punchRows(ravi)).map((p) => [p.direction, p.source])).toEqual([['IN', 'WEB'], ['OUT', 'WEB']]);
  });

  it('takes one punch from two clicks sent together', async () => {
    const ravi = await hire(acme);
    await warmPool(4);

    const results = await Promise.allSettled([
      punches.punch(as(ravi), { direction: 'IN' }),
      punches.punch(as(ravi), { direction: 'IN' }),
      punches.punch(as(ravi), { direction: 'IN' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await punchRows(ravi)).toHaveLength(1);
  });

  it('files both ends of a night shift under the day it started, and knows to punch out after midnight', async () => {
    const ravi = await hire(acme);
    await rosters.assign(hr(), { employeeId: ravi.id, shiftId: nightShift, effectiveFrom: '2026-07-01', weeklyOffDays: [0] });

    try {
      now = ist('2026-07-13 21:55');
      await punches.punch(as(ravi), { direction: 'IN' });

      // The next morning: a new calendar date, the same attendance day.
      now = ist('2026-07-14 06:10');
      const status = await punches.status(as(ravi));
      expect(status.today.date).toBe('2026-07-13');
      expect(status.next).toBe('OUT');
      await punches.punch(as(ravi), { direction: 'OUT' });

      // That evening, tonight's shift: a fresh day.
      now = ist('2026-07-14 21:50');
      expect(await punches.status(as(ravi))).toMatchObject({ today: { date: '2026-07-14', punches: [] }, next: 'IN' });
    } finally {
      now = null;
    }

    const days = await punches.days(hr(), ravi.id, { from: '2026-07-13', to: '2026-07-14' });
    expect(days.map((d) => [d.date, d.punches.map((p) => p.direction)])).toEqual([
      ['2026-07-14', []],
      ['2026-07-13', ['IN', 'OUT']],
    ]);
    expect(days[1]!.shift).toMatchObject({ code: 'NIGHT', startTime: '22:00', endTime: '06:00' });
  });

  it('records the server\'s time, not a time anyone chose', async () => {
    const ravi = await hire(acme);
    const before = Date.now();
    const { today } = await punches.punch(as(ravi), { direction: 'IN' });
    const at = Date.parse(today.punches[0]!.at);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('refuses a punch before joining, and for a login with no employee behind it', async () => {
    const future = await hire(acme, { joinDate: '2099-01-01' });
    expect(await refusal(punches.punch(as(future), { direction: 'IN' }))).toMatchObject({ status: 400, fields: ['direction'] });
    expect(await refusal(punches.punch(actorIn(acme, EMPLOYEE, null), { direction: 'IN' })))
      .toMatchObject({ status: 403, code: 'NOT_AN_EMPLOYEE' });
  });

  it('shows the holiday and the weekly off on the days they fall', async () => {
    const ravi = await hire(acme);
    await policy.createHoliday(hr(), { date: '2026-08-14', name: 'Test holiday', locationId: bengaluru });
    const days = await punches.days(hr(), ravi.id, { from: '2026-08-14', to: '2026-08-16' });
    // Fri 14 Aug a holiday; Sun 16 Aug the company's weekly off.
    expect(days.map((d) => [d.date, d.holiday, d.weeklyOff])).toEqual([
      ['2026-08-16', null, true],
      ['2026-08-15', null, false],
      ['2026-08-14', 'Test holiday', false],
    ]);
  });
});

describeIfDb('whose punches you can read', () => {
  it('is your own, your reports\', or everyone\'s — and nobody else\'s, in any company', async () => {
    const lead = await hire(acme, { firstName: 'Lead' });
    const report = await hire(acme, { managerId: lead.id });
    const stranger = await hire(acme);
    const range = { from: '2026-09-01', to: '2026-09-02' };

    await expect(punches.days(as(report), report.id, range)).resolves.toHaveLength(2);
    await expect(punches.days(as(lead, MANAGER), report.id, range)).resolves.toHaveLength(2);
    await expect(punches.days(hr(), report.id, range)).resolves.toHaveLength(2);

    expect(await refusal(punches.days(as(stranger), report.id, range))).toMatchObject({ status: 404 });
    expect(await refusal(punches.days(as(report), lead.id, range))).toMatchObject({ status: 404 });
    expect(await refusal(punches.days(actorIn(globex, HR, null), report.id, range))).toMatchObject({ status: 404 });
  });

  it('cannot see another company\'s punches even by asking the table directly', async () => {
    const ravi = await hire(acme);
    await punches.punch(as(ravi), { direction: 'IN' });
    const seenByGlobex = await withTenant(db, globex, (tx) =>
      tx.select().from(punchEvent).where(eq(punchEvent.employeeId, ravi.id)));
    expect(seenByGlobex).toHaveLength(0);
    const rosterSeenByGlobex = await withTenant(db, globex, (tx) => tx.select().from(rosterAssignment));
    expect(rosterSeenByGlobex).toHaveLength(0);
  });
});

describeIfDb('a punch is evidence', () => {
  it('cannot be rewritten or deleted, even by a query that skips the service', async () => {
    const ravi = await hire(acme);
    await punches.punch(as(ravi), { direction: 'IN' });

    await expect(withTenant(db, acme, (tx) =>
      tx.update(punchEvent).set({ punchedAt: ist('2026-01-01 09:00') }).where(eq(punchEvent.employeeId, ravi.id))))
      .rejects.toThrow();
    await expect(withTenant(db, acme, (tx) => tx.delete(punchEvent).where(eq(punchEvent.employeeId, ravi.id))))
      .rejects.toThrow();
    expect(await punchRows(ravi)).toHaveLength(1);
  });

  it('goes with an employee who was never paid, when they are erased', async () => {
    const ravi = await hire(acme);
    await punches.punch(as(ravi), { direction: 'IN' });
    await rosters.assign(hr(), { employeeId: ravi.id, shiftId: nightShift, effectiveFrom: '2026-06-01', weeklyOffDays: [0] });

    expect(await employees.remove(hr(), ravi.id)).toEqual({ deleted: 'HARD' });

    expect(await punchRows(ravi)).toHaveLength(0);
    const roster = await withTenant(db, acme, (tx) =>
      tx.select().from(rosterAssignment).where(eq(rosterAssignment.employeeId, ravi.id)));
    expect(roster).toHaveLength(0);
  });
});

describeIfDb('signup', () => {
  it('gives a new company the General shift as its default', async () => {
    const tenants = new TenantService(db, new AuditService(db));
    const { tenantId, userId } = await tenants.signup({
      companyName: `Attendance Signup ${randomUUID().slice(0, 6)}`,
      adminEmail: `founder-${randomUUID().slice(0, 8)}@example.test`,
      adminPassword: 'correct horse battery staple',
      adminFirstName: 'Asha',
    });

    try {
      const seeded = await withTenant(db, tenantId, (tx) => tx.select().from(shift));
      expect(seeded.map((s) => [s.code, s.startMinute, s.endMinute, s.isDefault])).toEqual([['GEN', 570, 1110, true]]);
    } finally {
      await withPurgeMode(db, tenantId, 'attendance signup test teardown', (tx) =>
        tx.delete(tenant).where(eq(tenant.id, tenantId)));
      await db.delete(user).where(eq(user.id, userId));
    }
  });
});
