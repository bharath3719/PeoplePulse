import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  BadRequestException, ConflictException, HttpException, NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import {
  getDb, closeDb, withTenant, withPurgeMode, assertRlsEnforced,
  tenant, user, location, leaveTxn, leaveRequest, leaveType,
  type Database, type Employee,
} from '@peoplepulse/db';
import {
  addDays, istDate, toIstDate, weekdayOf,
  type Actor, type ApplyLeaveInput, type CreateEmployeeInput, type Permission,
} from '@peoplepulse/core';
import { AuditService } from '../../platform/audit/audit.service';
import { PiiService } from '../../platform/crypto/pii.service';
import { EmployeeService } from '../employee/employee.service';
import { TenantService } from '../tenant/tenant.service';
import { LeaveService } from './leave.service';
import { LeaveLedgerService } from './leave-ledger.service';
import { LeavePolicyService } from './leave-policy.service';

/**
 * Leave, against a real database.
 *
 * Real, because what goes wrong with leave goes wrong between transactions: two
 * applications that each see the same balance, two approvers who each see a
 * pending request, a ledger row someone tries to rewrite. Each test below tries
 * to get one of those through.
 *
 * Like every DB-backed suite here, this FAILS without a database rather than
 * skipping. SKIP_DB_TESTS=1 opts out, out loud.
 */
const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const OPTED_OUT = process.env['SKIP_DB_TESTS'] === '1';

if (!OPTED_OUT && !TEST_DB_URL) {
  throw new Error(
    'The leave suite cannot reach a database. Set TEST_DATABASE_URL (see .env.example), '
      + 'or SKIP_DB_TESTS=1 if you mean to run without one.',
  );
}

const describeIfDb = OPTED_OUT ? describe.skip : describe;

const EMPLOYEE: Permission[] = ['leave.apply', 'leave.view.own', 'employee.view'];
const MANAGER: Permission[] = [...EMPLOYEE, 'leave.view.team', 'leave.approve'];
const HR: Permission[] = [
  ...MANAGER, 'leave.view.all', 'leave.manage',
  'employee.view.all', 'employee.create', 'employee.edit', 'employee.delete',
];

const pii = new PiiService({ getOrThrow: () => 'test-only-pii-key' } as unknown as ConfigService);

let db: Database;
let leave: LeaveService;
let ledger: LeaveLedgerService;
let policy: LeavePolicyService;
let employees: EmployeeService;

let acme: string;
let globex: string;
let bengaluru: string; // an Acme location
let mysuru: string;    // another Acme location
let hrPerson: Employee; // Acme's HR admin is an employee too, so can be asked to approve their own leave
let globexHrPerson: Employee;
const typeIds = new Map<string, string>();

function actorIn(tenantId: string, permissions: Permission[], employeeId: string | null): Actor {
  return { userId: randomUUID(), tenantId, employeeId, permissions: new Set(permissions), mfaVerified: true };
}

const hr = () => actorIn(acme, HR, hrPerson.id);
/** HR with no employee record of their own — the founder, say — for setting up balances, including HR's. */
const admin = () => actorIn(acme, HR, null);
const as = (person: Employee, permissions: Permission[] = EMPLOYEE) => actorIn(person.tenantId, permissions, person.id);

function hire(tenantId: string, input: Partial<CreateEmployeeInput> = {}): Promise<Employee> {
  return employees.create(actorIn(tenantId, HR, null), {
    empCode: `E-${randomUUID().slice(0, 8)}`,
    firstName: 'Priya',
    joinDate: '2026-01-01',
    employmentType: 'FULL_TIME',
    hasPriorPfMembership: false,
    locationId: tenantId === acme ? bengaluru : undefined,
    ...input,
  });
}

function type(code: string, tenantId = acme): string {
  const id = typeIds.get(`${tenantId}:${code}`);
  if (!id) throw new Error(`no ${code} leave type in ${tenantId}`);
  return id;
}

/** An opening balance, entered by HR, so a test starts from a known number of days. */
async function give(person: Employee, days: number, code = 'CL', calendarYear = 2026) {
  await ledger.adjust(admin(), {
    employeeId: person.id, leaveTypeId: type(code), calendarYear, kind: 'OPENING', days, reason: 'test balance',
  });
}

function span(startDate: string, endDate: string, code = 'CL', extra: Partial<ApplyLeaveInput> = {}): ApplyLeaveInput {
  return { leaveTypeId: type(code), startDate, endDate, startSession: 'FIRST', endSession: 'SECOND', ...extra };
}

async function balanceOf(person: Employee, code = 'CL', year = 2026) {
  const rows = await ledger.balances(hr(), person.id, year);
  return rows.find((r) => r.leaveType.code === code)!;
}

function ledgerRows(person: Employee) {
  return withTenant(db, person.tenantId, (tx) => tx.select().from(leaveTxn).where(eq(leaveTxn.employeeId, person.id)));
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

/**
 * Open connections before a race. Otherwise each racer waits on a fresh
 * connection's handshake, which takes longer than the whole transaction, so the
 * "race" runs one at a time and passes with or without the lock (see the MFA
 * burst test in auth.service.test.ts, which learned this first).
 */
async function warmPool(connections: number) {
  await Promise.all(Array.from({ length: connections }, () => db.execute(sql`select pg_sleep(0.05)`)));
}

/** A Monday comfortably in the future, for leave that has not started yet. */
function futureMonday(): string {
  let date = addDays(toIstDate(new Date()), 30);
  while (weekdayOf(date) !== 1 || date.endsWith('-12-31')) date = addDays(date, 1);
  return date;
}

beforeAll(async () => {
  if (!TEST_DB_URL) return;

  db = getDb(TEST_DB_URL);
  await assertRlsEnforced(db);

  const audit = new AuditService(db);
  leave = new LeaveService(db, audit);
  ledger = new LeaveLedgerService(db, audit);
  policy = new LeavePolicyService(db, audit);
  employees = new EmployeeService(db, audit, pii);

  const suffix = randomUUID().slice(0, 8);
  const [a] = await db.insert(tenant).values({ name: 'Acme Textiles', slug: `acme-leave-${suffix}` }).returning();
  const [g] = await db.insert(tenant).values({ name: 'Globex Motors', slug: `globex-leave-${suffix}` }).returning();
  acme = a!.id;
  globex = g!.id;

  await withTenant(db, acme, async (tx) => {
    const [b] = await tx.insert(location).values({ tenantId: acme, name: 'Bengaluru', state: 'KARNATAKA' }).returning();
    const [m] = await tx.insert(location).values({ tenantId: acme, name: 'Mysuru', state: 'KARNATAKA' }).returning();
    bengaluru = b!.id;
    mysuru = m!.id;
  });

  hrPerson = await hire(acme, { firstName: 'Meena' });
  globexHrPerson = await hire(globex, { firstName: 'Kabir' });

  for (const [tenantId, person] of [[acme, hrPerson], [globex, globexHrPerson]] as const) {
    const actor = actorIn(tenantId, HR, person.id);
    // A five-day week, so the dates below land where they say they do.
    await policy.updateSettings(actor, { weeklyOffDays: [0, 6] });
    for (const t of await policy.addDefaultTypes(actor)) typeIds.set(`${tenantId}:${t.code}`, t.id);
  }
});

afterAll(async () => {
  for (const id of [acme, globex]) {
    if (id) {
      await withPurgeMode(db, id, 'leave test teardown', (tx) => tx.delete(tenant).where(eq(tenant.id, id)));
    }
  }
  await closeDb();
});

describeIfDb('applying for leave', () => {
  it('counts working days, skipping weekends and the holidays at the employee\'s own location', async () => {
    const priya = await hire(acme);
    await give(priya, 12);
    const actor = hr();
    await policy.createHoliday(actor, { date: '2026-03-04', name: 'Bengaluru only', locationId: bengaluru });
    await policy.createHoliday(actor, { date: '2026-03-05', name: 'Mysuru only', locationId: mysuru });

    // Mon 2 Mar to Mon 9 Mar: six weekdays, less Bengaluru's holiday on the
    // 4th. Mysuru's on the 5th is not hers.
    const request = await leave.apply(as(priya), span('2026-03-02', '2026-03-09'));
    expect(request.days).toBe(5);
    expect(request.status).toBe('PENDING');
  });

  it('refuses more than the balance, counting what is already requested', async () => {
    const priya = await hire(acme);
    await give(priya, 3);

    await leave.apply(as(priya), span('2026-04-06', '2026-04-07'));                 // 2 days, pending
    expect(await refusal(leave.apply(as(priya), span('2026-04-13', '2026-04-14')))) // 2 more: only 1 left
      .toMatchObject({ status: 409, code: 'INSUFFICIENT_BALANCE' });

    expect(await balanceOf(priya)).toMatchObject({ balanceDays: 3, pendingDays: 2, availableDays: 1 });
  });

  it('lets two applications sent together spend the same days only once', async () => {
    // The race the employee-row lock exists for. Without it, both read
    // "2 days available", both pass, and 4 days are promised out of 2.
    const priya = await hire(acme);
    await give(priya, 2);
    await warmPool(3);

    const results = await Promise.allSettled([
      leave.apply(as(priya), span('2026-05-04', '2026-05-05')),
      leave.apply(as(priya), span('2026-05-11', '2026-05-12')),
      leave.apply(as(priya), span('2026-05-18', '2026-05-19')),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await balanceOf(priya)).pendingDays).toBe(2);
  });

  it('refuses overlapping leave, but takes the other half of a half day', async () => {
    const priya = await hire(acme);
    await give(priya, 12);

    await leave.apply(as(priya), span('2026-06-01', '2026-06-01', 'CL', { endSession: 'FIRST' }));       // morning
    const afternoon = await leave.apply(as(priya), span('2026-06-01', '2026-06-01', 'CL', { startSession: 'SECOND' }));
    expect(afternoon.days).toBe(0.5);

    expect(await refusal(leave.apply(as(priya), span('2026-05-29', '2026-06-01'))))
      .toMatchObject({ status: 409, code: 'LEAVE_OVERLAP' });
  });

  it('refuses a half day of leave that is taken in whole days', async () => {
    const priya = await hire(acme);
    await give(priya, 5, 'EL');
    expect(await refusal(leave.apply(as(priya), span('2026-06-08', '2026-06-08', 'EL', { endSession: 'FIRST' }))))
      .toMatchObject({ status: 400, fields: ['startSession'] });
  });

  it('refuses leave from before the person joined', async () => {
    const priya = await hire(acme, { joinDate: '2026-06-15' });
    await give(priya, 5);
    expect(await refusal(leave.apply(as(priya), span('2026-06-10', '2026-06-16'))))
      .toMatchObject({ status: 400, fields: ['startDate'] });
  });

  it('refuses a span that is only weekend', async () => {
    const priya = await hire(acme);
    await give(priya, 5);
    expect(await refusal(leave.apply(as(priya), span('2026-06-13', '2026-06-14'))))
      .toMatchObject({ status: 400, fields: ['startDate'] });
  });

  it('needs no balance for unpaid leave, and writes nothing to the ledger for it', async () => {
    const priya = await hire(acme);
    const anil = await hire(acme, { firstName: 'Anil' });
    await employees.update(hr(), priya.id, { managerId: anil.id });

    const request = await leave.apply(as(priya), span('2026-06-22', '2026-06-23', 'LOP'));
    await leave.decide(as(anil, MANAGER), request.id, { decision: 'APPROVE' });

    expect(await ledgerRows(priya)).toHaveLength(0);
    expect(await balanceOf(priya, 'LOP')).toMatchObject({ balanceDays: null, takenDays: 2 });
  });

  it('turns away a login with no employee record — there is no one to take leave for', async () => {
    const accountant = actorIn(acme, EMPLOYEE, null);
    expect(await refusal(leave.apply(accountant, span('2026-06-22', '2026-06-22'))))
      .toMatchObject({ status: 403, code: 'NOT_AN_EMPLOYEE' });
  });
});

describeIfDb('deciding on leave', () => {
  async function team() {
    const anil = await hire(acme, { firstName: 'Anil' });
    const priya = await hire(acme);
    await employees.update(hr(), priya.id, { managerId: anil.id });
    return { anil, priya: { ...priya, managerId: anil.id } };
  }

  it('lets a manager approve a direct report, and takes the days once', async () => {
    const { anil, priya } = await team();
    await give(priya, 5);
    const request = await leave.apply(as(priya), span('2026-07-06', '2026-07-07'));

    const approved = await leave.decide(as(anil, MANAGER), request.id, { decision: 'APPROVE' });

    expect(approved.status).toBe('APPROVED');
    expect((await ledgerRows(priya)).filter((t) => t.kind === 'DEBIT').map((t) => t.daysHundredths)).toEqual([-200]);
    expect(await balanceOf(priya)).toMatchObject({ balanceDays: 3, pendingDays: 0, takenDays: 2 });
  });

  it('lets nobody approve their own leave, whatever they hold', async () => {
    // HR can approve anyone's leave. Not their own: that is choosing not to be
    // docked pay, and no permission means that.
    await give(hrPerson, 5);
    const own = await leave.apply(hr(), span('2026-07-13', '2026-07-13'));

    expect(own.canDecide).toBe(false);
    expect(await refusal(leave.decide(hr(), own.id, { decision: 'APPROVE' })))
      .toMatchObject({ status: 403, code: 'OWN_LEAVE' });
  });

  it('keeps a manager to their own team, seeing and deciding', async () => {
    const { anil } = await team();
    const outsider = await hire(acme, { firstName: 'Ravi' });
    await give(outsider, 5);
    const request = await leave.apply(as(outsider), span('2026-07-20', '2026-07-20'));

    await expect(leave.decide(as(anil, MANAGER), request.id, { decision: 'APPROVE' }))
      .rejects.toBeInstanceOf(NotFoundException);
    const visible = await leave.list(as(anil, MANAGER), {});
    expect(visible.map((r) => r.id)).not.toContain(request.id);
    await expect(ledger.balances(as(anil, MANAGER), outsider.id, 2026)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets two approvers clicking together decide once — the other is told', async () => {
    const { anil, priya } = await team();
    await give(priya, 5);
    const request = await leave.apply(as(priya), span('2026-07-27', '2026-07-28'));
    await warmPool(2);

    const results = await Promise.allSettled([
      leave.decide(as(anil, MANAGER), request.id, { decision: 'APPROVE' }),
      leave.decide(hr(), request.id, { decision: 'APPROVE' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(ConflictException);
    expect((await ledgerRows(priya)).filter((t) => t.kind === 'DEBIT')).toHaveLength(1);
  });

  it('re-checks the balance at approval — it can have moved since the request', async () => {
    const { anil, priya } = await team();
    await give(priya, 2);
    const request = await leave.apply(as(priya), span('2026-08-03', '2026-08-04'));
    await ledger.adjust(hr(), {
      employeeId: priya.id, leaveTypeId: type('CL'), calendarYear: 2026, kind: 'ADJUSTMENT', days: -1,
      reason: 'over-credited at go-live',
    });

    expect(await refusal(leave.decide(as(anil, MANAGER), request.id, { decision: 'APPROVE' })))
      .toMatchObject({ status: 409, code: 'INSUFFICIENT_BALANCE' });
    expect((await balanceOf(priya)).balanceDays).toBe(1);
  });

  it('rejects without touching the balance', async () => {
    const { anil, priya } = await team();
    await give(priya, 5);
    const request = await leave.apply(as(priya), span('2026-08-10', '2026-08-10'));

    const rejected = await leave.decide(as(anil, MANAGER), request.id, { decision: 'REJECT', note: 'Audit week' });

    expect(rejected).toMatchObject({ status: 'REJECTED', decisionNote: 'Audit week' });
    expect(await balanceOf(priya)).toMatchObject({ balanceDays: 5, pendingDays: 0 });
  });
});

describeIfDb('cancelling leave', () => {
  it('gives the days back when approved leave is cancelled before it starts', async () => {
    const monday = futureMonday();
    const year = Number(monday.slice(0, 4));
    const priya = await hire(acme);
    await give(priya, 5, 'CL', year);
    const request = await leave.apply(as(priya), span(monday, addDays(istDate(monday), 1)));
    await leave.decide(hr(), request.id, { decision: 'APPROVE' });
    expect((await balanceOf(priya, 'CL', year)).balanceDays).toBe(3);

    const cancelled = await leave.cancel(as(priya), request.id);

    expect(cancelled.status).toBe('CANCELLED');
    expect((await balanceOf(priya, 'CL', year)).balanceDays).toBe(5);
    expect((await ledgerRows(priya)).map((t) => t.kind).sort()).toEqual(['DEBIT', 'OPENING', 'REVERSAL']);
  });

  it('will not let the employee cancel approved leave that has already started', async () => {
    const priya = await hire(acme);
    await give(priya, 5);
    const request = await leave.apply(as(priya), span('2026-09-07', '2026-09-08'));
    await leave.decide(hr(), request.id, { decision: 'APPROVE' });

    expect(await refusal(leave.cancel(as(priya), request.id)))
      .toMatchObject({ status: 409, code: 'ALREADY_STARTED' });
  });

  it('will not let anyone cancel another person\'s request', async () => {
    const priya = await hire(acme);
    const ravi = await hire(acme, { firstName: 'Ravi' });
    await give(priya, 5);
    const request = await leave.apply(as(priya), span('2026-09-14', '2026-09-14'));

    await expect(leave.cancel(as(ravi), request.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describeIfDb('accruals', () => {
  it('posts each month once, however many times it runs', async () => {
    const priya = await hire(acme, { joinDate: '2025-04-01' });

    const first = await ledger.postAccruals(hr(), { through: '2026-10' });
    const again = await ledger.postAccruals(hr(), { through: '2026-10' });

    expect(first.posted).toBeGreaterThan(0);
    expect(again.posted).toBe(0);
    // EL is 15 a year, monthly: ten months is 12.5. CL is granted for the year.
    expect((await balanceOf(priya, 'EL')).balanceDays).toBe(12.5);
    expect((await balanceOf(priya, 'CL')).balanceDays).toBe(12);
    const accruals = (await ledgerRows(priya)).filter((t) => t.kind === 'ACCRUAL');
    expect(new Set(accruals.map((t) => t.accrualPeriod)).size).toBe(accruals.length);
  });

  it('pro-rates someone who joined mid-year', async () => {
    const priya = await hire(acme, { joinDate: '2026-07-01' });
    await ledger.postAccruals(hr(), { through: '2026-10' });

    expect((await balanceOf(priya, 'CL')).balanceDays).toBe(6);    // half the year
    expect((await balanceOf(priya, 'EL')).balanceDays).toBe(5);    // July..October at 1.25
  });

  it('refuses a month that has not started', async () => {
    expect(await refusal(ledger.postAccruals(hr(), { through: '2099-01' })))
      .toMatchObject({ status: 400, fields: ['through'] });
  });
});

describeIfDb('adjusting a balance by hand', () => {
  it('will not let anyone adjust their own balance', async () => {
    expect(await refusal(ledger.adjust(hr(), {
      employeeId: hrPerson.id, leaveTypeId: type('CL'), calendarYear: 2026, kind: 'ADJUSTMENT', days: 30,
      reason: 'generous',
    }))).toMatchObject({ status: 403, code: 'OWN_BALANCE' });
  });

  it('has nothing to adjust on unpaid leave', async () => {
    const priya = await hire(acme);
    await expect(ledger.adjust(hr(), {
      employeeId: priya.id, leaveTypeId: type('LOP'), calendarYear: 2026, kind: 'OPENING', days: 3, reason: 'go-live',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('shows every entry behind the balance, with its reason', async () => {
    const priya = await hire(acme);
    await give(priya, 4);
    await ledger.adjust(hr(), {
      employeeId: priya.id, leaveTypeId: type('CL'), calendarYear: 2026, kind: 'ADJUSTMENT', days: 0.5,
      reason: 'half day owed from March',
    });

    const entries = await ledger.ledger(as(priya), priya.id, 2026);
    expect(entries.map((e) => [e.kind, e.days, e.reason])).toEqual([
      ['OPENING', 4, 'test balance'],
      ['ADJUSTMENT', 0.5, 'half day owed from March'],
    ]);
  });
});

describeIfDb('across companies', () => {
  it('gives Globex nothing of Acme\'s by id — not a balance, a decision, nor an adjustment', async () => {
    const priya = await hire(acme);
    await give(priya, 5);
    const request = await leave.apply(as(priya), span('2026-10-05', '2026-10-05'));
    const globexHr = actorIn(globex, HR, globexHrPerson.id);

    await expect(ledger.balances(globexHr, priya.id, 2026)).rejects.toBeInstanceOf(NotFoundException);
    await expect(leave.decide(globexHr, request.id, { decision: 'APPROVE' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(ledger.adjust(globexHr, {
      employeeId: priya.id, leaveTypeId: type('CL', globex), calendarYear: 2026, kind: 'OPENING', days: 5, reason: 'x',
    })).rejects.toBeInstanceOf(NotFoundException);
    expect((await leave.list(globexHr, {})).map((r) => r.id)).not.toContain(request.id);

    // Still pending, still Acme's.
    const [after] = await withTenant(db, acme, (tx) => tx.select().from(leaveRequest).where(eq(leaveRequest.id, request.id)));
    expect(after!.status).toBe('PENDING');
  });

  it('will not let a Globex employee apply against an Acme leave type', async () => {
    const kabir = await hire(globex, { firstName: 'Kabir' });
    expect(await refusal(leave.apply(as(kabir), { ...span('2026-10-05', '2026-10-05'), leaveTypeId: type('CL', acme) })))
      .toMatchObject({ status: 400, fields: ['leaveTypeId'] });
  });

  it('will not hang a holiday on another company\'s location — the foreign key would let it', async () => {
    expect(await refusal(policy.createHoliday(actorIn(globex, HR, globexHrPerson.id), {
      date: '2026-10-02', name: 'Gandhi Jayanti', locationId: bengaluru,
    }))).toMatchObject({ status: 400, fields: ['locationId'] });
  });
});

describeIfDb('erasing an employee who was never paid', () => {
  it('takes their leave history with them — the append-only ledger yields to that one erasure', async () => {
    const priya = await hire(acme);
    await give(priya, 5);
    const request = await leave.apply(as(priya), span('2026-10-12', '2026-10-13'));
    await leave.decide(hr(), request.id, { decision: 'APPROVE' });
    expect((await ledgerRows(priya)).length).toBe(2);

    expect(await employees.remove(hr(), priya.id)).toEqual({ deleted: 'HARD' });

    expect(await ledgerRows(priya)).toHaveLength(0);
    const requests = await withTenant(db, acme, (tx) =>
      tx.select().from(leaveRequest).where(eq(leaveRequest.employeeId, priya.id)));
    expect(requests).toHaveLength(0);
  });
});

describeIfDb('signup', () => {
  it('gives a new company the standard leave types, as data it can edit', async () => {
    const tenants = new TenantService(db, new AuditService(db));
    const { tenantId, userId } = await tenants.signup({
      companyName: `Leave Signup ${randomUUID().slice(0, 6)}`,
      adminEmail: `founder-${randomUUID().slice(0, 8)}@example.test`,
      adminPassword: 'correct horse battery staple',
      adminFirstName: 'Asha',
    });

    try {
      const codes = await withTenant(db, tenantId, (tx) =>
        tx.select({ code: leaveType.code }).from(leaveType));
      expect(codes.map((c) => c.code).sort()).toEqual(['CL', 'EL', 'LOP', 'ML', 'SL']);
    } finally {
      await withPurgeMode(db, tenantId, 'leave signup test teardown', (tx) =>
        tx.delete(tenant).where(eq(tenant.id, tenantId)));
      await db.delete(user).where(eq(user.id, userId));
    }
  });
});
