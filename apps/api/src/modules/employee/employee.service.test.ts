import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import {
  BadRequestException, ConflictException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { and, asc, eq } from 'drizzle-orm';
import {
  getDb, closeDb, withTenant, withPurgeMode, assertRlsEnforced,
  tenant, employee, employeeEvent, auditLog, department,
  type Database, type Employee,
} from '@peoplepulse/db';
import type { Actor, CreateEmployeeInput, Permission } from '@peoplepulse/core';
import { AuditService } from '../../platform/audit/audit.service';
import { PiiService } from '../../platform/crypto/pii.service';
import { EmployeeService } from './employee.service';

/**
 * Correcting an employee (PATCH /employees/:id), against a real database.
 *
 * Real, because the failures worth fearing here live in Postgres, not in the
 * service's branching: a foreign key that ignores row-level security, a
 * reporting chain that loops, an audit row that quietly holds a PAN. Each test
 * tries to get one of those past the service.
 *
 * Like the isolation suite, this FAILS without a database rather than skipping.
 * SKIP_DB_TESTS=1 opts out, out loud.
 */
const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const OPTED_OUT = process.env['SKIP_DB_TESTS'] === '1';

if (!OPTED_OUT && !TEST_DB_URL) {
  throw new Error(
    'The employee-edit suite cannot reach a database. Set TEST_DATABASE_URL ' +
      '(see .env.example), or SKIP_DB_TESTS=1 if you mean to run without one.',
  );
}

const describeIfDb = OPTED_OUT ? describe.skip : describe;

const HR: Permission[] = [
  'employee.view', 'employee.view.all', 'employee.create', 'employee.edit',
  'employee.identifiers.view',
];
const HR_WITH_SALARY: Permission[] = [...HR, 'employee.salary.view'];

const pii = new PiiService({ getOrThrow: () => 'test-only-pii-key' } as unknown as ConfigService);

let db: Database;
let service: EmployeeService;
let acme: string;   // EPF-registered
let globex: string; // the other company, whose ids must never stick to Acme's rows

function actorIn(tenantId: string, permissions: Permission[], employeeId: string | null = null): Actor {
  return {
    userId: randomUUID(), tenantId, employeeId, permissions: new Set(permissions), mfaVerified: true,
  };
}

/** Hired through the real create path, so PF status is derived the way production derives it. */
function hire(tenantId: string, input: Partial<CreateEmployeeInput> = {}): Promise<Employee> {
  return service.create(actorIn(tenantId, HR_WITH_SALARY), {
    empCode: `E-${randomUUID().slice(0, 8)}`,
    firstName: 'Priya',
    lastName: 'Sharma',
    joinDate: '2026-07-01',
    employmentType: 'FULL_TIME',
    hasPriorPfMembership: false,
    pfWageAtJoiningRupees: 18_000, // above Rs 15,000: EXCLUDED at a registered company
    ...input,
  });
}

function reload(row: Employee): Promise<Employee> {
  return withTenant(db, row.tenantId, async (tx) => {
    const [found] = await tx.select().from(employee).where(eq(employee.id, row.id));
    return found!;
  });
}

function auditFor(row: Employee, action: string) {
  return withTenant(db, row.tenantId, (tx) => tx.select().from(auditLog)
    .where(and(eq(auditLog.entityId, row.id), eq(auditLog.action, action)))
    .orderBy(asc(auditLog.at)));
}

function eventsFor(row: Employee) {
  return withTenant(db, row.tenantId, (tx) => tx.select().from(employeeEvent)
    .where(eq(employeeEvent.employeeId, row.id))
    .orderBy(asc(employeeEvent.createdAt)));
}

/** The fields a 400/409 blamed — what the edit form attaches its messages to. */
async function blamedFields(attempt: Promise<unknown>): Promise<string[]> {
  const error = await attempt.then(() => null, (e: unknown) => e);
  if (!(error instanceof BadRequestException || error instanceof ConflictException)) {
    throw new Error(`expected a field-level rejection, got ${String(error)}`);
  }
  const body = error.getResponse() as { errors: { field: string }[] };
  return body.errors.map((e) => e.field);
}

beforeAll(async () => {
  if (!TEST_DB_URL) return;

  db = getDb(TEST_DB_URL);
  // Connected as the app role, or every "cannot reach across tenants" below
  // would pass for the wrong reason (ADR-006).
  await assertRlsEnforced(db);

  service = new EmployeeService(db, new AuditService(db), pii);

  const suffix = randomUUID().slice(0, 8);
  const [a] = await db.insert(tenant)
    .values({ name: 'Acme Textiles', slug: `acme-edit-${suffix}`, epfRegistered: true })
    .returning({ id: tenant.id });
  const [g] = await db.insert(tenant)
    .values({ name: 'Globex Motors', slug: `globex-edit-${suffix}`, epfRegistered: true })
    .returning({ id: tenant.id });
  acme = a!.id;
  globex = g!.id;
});

afterAll(async () => {
  // Deleting a tenant cascades into employee_event and audit_log, which are
  // append-only — exactly the case purge mode exists for.
  for (const id of [acme, globex]) {
    if (id) {
      await withPurgeMode(db, id, 'employee-edit test teardown', (tx) =>
        tx.delete(tenant).where(eq(tenant.id, id)));
    }
  }
  await closeDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describeIfDb('correcting an employee', () => {
  it('changes what was sent and audits only that', async () => {
    const priya = await hire(acme, { phone: '+91 98450 12345' });

    await service.update(actorIn(acme, HR), priya.id, { firstName: 'Pria' });

    expect((await reload(priya)).firstName).toBe('Pria');
    expect((await reload(priya)).phone).toBe('+91 98450 12345');

    const [entry] = await auditFor(priya, 'UPDATE');
    expect(entry!.before).toEqual({ firstName: 'Priya' });
    expect(entry!.after).toEqual({ firstName: 'Pria' });
  });

  it('clears a field sent as null, and leaves absent fields alone', async () => {
    const priya = await hire(acme, { workEmail: 'priya@acme.in', phone: '+91 98450 12345' });

    await service.update(actorIn(acme, HR), priya.id, { workEmail: null });

    const after = await reload(priya);
    expect(after.workEmail).toBeNull();
    expect(after.phone).toBe('+91 98450 12345');
  });

  it('writes nothing — not even an audit entry — when nothing changed', async () => {
    const priya = await hire(acme);

    await service.update(actorIn(acme, HR), priya.id, { firstName: 'Priya', lastName: 'Sharma' });

    expect(await auditFor(priya, 'UPDATE')).toHaveLength(0);
    expect((await reload(priya)).updatedAt).toEqual(priya.updatedAt);
  });

  it('stores a corrected PAN encrypted, and never lets it into the audit log', async () => {
    const priya = await hire(acme);

    await service.update(actorIn(acme, HR), priya.id, { pan: 'ABCDE1234F' });

    const after = await reload(priya);
    expect(after.panLast4).toBe('234F');
    expect(after.panEncrypted).not.toContain('ABCDE1234F');
    expect(pii.decrypt(after.panEncrypted!)).toBe('ABCDE1234F');

    const [entry] = await auditFor(priya, 'UPDATE');
    expect(JSON.stringify(entry)).not.toContain('ABCDE1234F');
    expect(entry!.after).toEqual({ pan: '[redacted]' });
  });
});

describeIfDb('who may correct whom', () => {
  it('refuses a sensitive field the editor cannot read — and changes nothing else', async () => {
    const priya = await hire(acme);

    // HR without salary visibility, "correcting" a wage they cannot see.
    const attempt = service.update(actorIn(acme, HR), priya.id, {
      firstName: 'Pria', pfWageAtJoiningRupees: 12_000,
    });

    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    expect((await reload(priya)).firstName).toBe('Priya');
  });

  it('cannot correct another company\'s employee, even by exact id', async () => {
    const priya = await hire(acme);

    const attempt = service.update(actorIn(globex, HR), priya.id, { firstName: 'HACKED' });

    await expect(attempt).rejects.toBeInstanceOf(NotFoundException);
    expect((await reload(priya)).firstName).toBe('Priya');
  });

  it('limits a team-scoped editor to their own reports', async () => {
    const manager = await hire(acme, { firstName: 'Meera' });
    const report = await hire(acme, { firstName: 'Ravi', managerId: manager.id });
    const stranger = await hire(acme, { firstName: 'Anil' });

    const teamEditor = actorIn(acme, ['employee.view', 'employee.edit'], manager.id);

    await service.update(teamEditor, report.id, { phone: '+91 90000 00001' });
    expect((await reload(report)).phone).toBe('+91 90000 00001');

    await expect(service.update(teamEditor, stranger.id, { phone: '+91 90000 00002' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});

describeIfDb('every reference must belong to this company', () => {
  it('rejects a department from another company', async () => {
    const priya = await hire(acme);
    const [foreign] = await withTenant(db, globex, (tx) => tx.insert(department)
      .values({ tenantId: globex, name: `Paint Shop ${randomUUID()}` })
      .returning());

    expect(await blamedFields(
      service.update(actorIn(acme, HR), priya.id, { departmentId: foreign!.id }),
    )).toEqual(['departmentId']);

    // Why the service has to ask: the foreign key alone takes it, because
    // Postgres checks foreign keys WITHOUT row-level security.
    const other = await hire(acme);
    await withTenant(db, acme, (tx) => tx.update(employee)
      .set({ departmentId: foreign!.id }).where(eq(employee.id, other.id)));
    expect((await reload(other)).departmentId).toBe(foreign!.id);
  });

  it('rejects a manager from another company', async () => {
    const priya = await hire(acme);
    const outsider = await hire(globex);

    expect(await blamedFields(
      service.update(actorIn(acme, HR), priya.id, { managerId: outsider.id }),
    )).toEqual(['managerId']);
  });

  it('refuses to make someone their own manager', async () => {
    const priya = await hire(acme);

    expect(await blamedFields(
      service.update(actorIn(acme, HR), priya.id, { managerId: priya.id }),
    )).toEqual(['managerId']);
  });

  it('refuses a reporting loop, however long the chain', async () => {
    const ceo = await hire(acme, { firstName: 'Asha' });
    const vp = await hire(acme, { firstName: 'Vikram', managerId: ceo.id });
    const lead = await hire(acme, { firstName: 'Lata', managerId: vp.id });

    // lead -> vp -> ceo. Making the CEO report to the lead closes the circle.
    expect(await blamedFields(
      service.update(actorIn(acme, HR), ceo.id, { managerId: lead.id }),
    )).toEqual(['managerId']);
    expect((await reload(ceo)).managerId).toBeNull();
  });
});

describeIfDb('hire-time PF facts (ADR-004)', () => {
  it('a UAN added to an EXCLUDED employee makes them a MEMBER, on the record', async () => {
    const priya = await hire(acme);
    expect(priya.pfStatus).toBe('EXCLUDED');

    await service.update(actorIn(acme, HR), priya.id, { uan: '100200300400' });

    const after = await reload(priya);
    expect(after.pfStatus).toBe('MEMBER');
    expect(after.hasPriorPfMembership).toBe(true);

    const change = (await eventsFor(priya)).find((e) => e.type === 'PF_STATUS_CHANGE');
    expect(change!.payload).toMatchObject({ from: 'EXCLUDED', to: 'MEMBER' });
    expect(change!.effectiveDate).toBe('2026-07-01'); // what it should have been from joining
  });

  it('a corrected PF wage below the ceiling re-derives the status', async () => {
    const priya = await hire(acme);

    await service.update(actorIn(acme, HR_WITH_SALARY), priya.id, { pfWageAtJoiningRupees: 12_000 });

    const after = await reload(priya);
    expect(after.pfStatus).toBe('MEMBER');
    expect(after.pfJoiningWagePaise).toBe(1_200_000);

    // The wage is salary information: the log says THAT it changed, not to what.
    const [entry] = await auditFor(priya, 'UPDATE');
    expect(entry!.after).toMatchObject({ pfJoiningWagePaise: '[redacted]', pfStatus: 'MEMBER' });
  });

  it('THE TRAP: an unrelated edit never recomputes PF status', async () => {
    // A MEMBER whose stored facts would derive EXCLUDED today — as after an
    // opt-in (ADR-004 case 3). Recomputing on every save would silently
    // un-enrol them the next time someone fixed their phone number.
    const priya = await hire(acme);
    await withTenant(db, acme, (tx) => tx.update(employee)
      .set({ pfStatus: 'MEMBER' }).where(eq(employee.id, priya.id)));

    await service.update(actorIn(acme, HR), priya.id, { phone: '+91 90000 00003' });

    expect((await reload(priya)).pfStatus).toBe('MEMBER');
    expect((await eventsFor(priya)).map((e) => e.type)).toEqual(['JOIN']);
  });

  it('a join-date correction appends a new JOIN; the original stays', async () => {
    const priya = await hire(acme);

    await service.update(actorIn(acme, HR), priya.id, { joinDate: '2026-07-10' });

    expect((await reload(priya)).joinDate).toBe('2026-07-10');
    const joins = (await eventsFor(priya)).filter((e) => e.type === 'JOIN');
    expect(joins.map((e) => e.effectiveDate)).toEqual(['2026-07-01', '2026-07-10']);
  });

  it('locks them once the employee has been through a finalised payroll run', async () => {
    const priya = await hire(acme);
    vi.spyOn(
      EmployeeService.prototype as unknown as { hasFinalisedPayroll(): Promise<boolean> },
      'hasFinalisedPayroll',
    ).mockResolvedValue(true);

    expect(await blamedFields(
      service.update(actorIn(acme, HR), priya.id, { joinDate: '2026-07-10' }),
    )).toEqual(['joinDate']);
    expect(await blamedFields(
      service.update(actorIn(acme, HR), priya.id, { uan: '100200300400' }),
    )).toEqual(['uan']);

    const after = await reload(priya);
    expect(after.pfStatus).toBe('EXCLUDED');
    expect(after.uan).toBeNull();

    // Everything that is not a hire fact is still correctable.
    await service.update(actorIn(acme, HR), priya.id, { firstName: 'Pria' });
    expect((await reload(priya)).firstName).toBe('Pria');
  });
});

describeIfDb('changing bank details', () => {
  it('stores the account encrypted and keeps the number out of the audit log', async () => {
    const priya = await hire(acme);
    const payroll = actorIn(acme, ['employee.view', 'employee.view.all', 'employee.bank.edit']);

    await service.updateBank(payroll, priya.id, {
      bankAccount: '501002003004', bankIfsc: 'HDFC0001234',
    });

    const after = await reload(priya);
    expect(after.bankAccountLast4).toBe('3004');
    expect(pii.decrypt(after.bankAccountEncrypted!)).toBe('501002003004');
    expect(after.bankIfsc).toBe('HDFC0001234');

    const [entry] = await auditFor(priya, 'UPDATE_BANK');
    expect(JSON.stringify(entry)).not.toContain('501002003004');
    expect(entry!.after).toMatchObject({ bankAccount: '[redacted]', bankIfsc: 'HDFC0001234' });
  });
});
