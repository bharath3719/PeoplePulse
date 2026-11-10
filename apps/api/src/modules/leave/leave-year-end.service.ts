import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  employee, leaveRequest, leaveTxn, leaveType, withTenant,
  type Database, type LeaveType, type TenantDatabase,
} from '@peoplepulse/db';
import {
  can, dayHundredths, formatDays, leaveYearOf, payrollMonth, toIstDate, yearEndSplit,
  type Actor, type DayHundredths, type LeaveYearEndInput, type YearEndRule,
} from '@peoplepulse/core';
import { DB } from '../../platform/database/database.module';
import { AuditService } from '../../platform/audit/audit.service';
import { validationFailed } from '../../platform/validation/zod.pipe';
import { inYear } from './leave-access';
import { insertLedgerRows, postCredits } from './leave-credits';
import { days, type LeaveYearEndView, type YearEndSkipReason } from './leave.dto';

/** Thrown to roll a preview's transaction back, carrying what the close would have done. */
class DryRun extends Error {
  constructor(readonly result: LeaveYearEndView) {
    super('dry run');
  }
}

type LedgerRow = typeof leaveTxn.$inferInsert;

/**
 * Closing a leave year (LVE-02, OPEN.md D-25; ADR-008).
 *
 * Balances are per calendar year (D-17). Closing year Y moves what is left of
 * each paid balance out of Y — into Y+1 as far as the type carries it, then
 * set aside for encashment, and the rest lapsed — so Y sums to zero and Y+1
 * opens with what carried. Every movement is a ledger entry with the rule that
 * made it, so "where did my 20 days go?" is answered line by line.
 *
 * A close is RE-RUNNABLE and converges. It moves whatever Y still holds, within
 * the room each type's limits leave after earlier closes of Y, so running it
 * twice moves nothing the second time — and running it again after leave in Y
 * is cancelled (giving days back to Y) sweeps those days too. Years can be
 * closed in any order for the same reason: closing 2025 late carries into a
 * 2026 that the next close of 2026 sweeps on.
 *
 * Previewing runs the very same close and rolls it back, so the preview cannot
 * disagree with the close it previews.
 */
@Injectable()
export class LeaveYearEndService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** What closing would do, with balances as they stand. Writes nothing. Allowed while the year is still running. */
  async preview(actor: Actor, input: LeaveYearEndInput): Promise<LeaveYearEndView> {
    this.assertMayClose(actor);
    if (input.year > thisYear()) {
      throw validationFailed([{ field: 'year', message: `${input.year} has not started yet` }]);
    }
    return this.run(actor, input.year, true);
  }

  /**
   * Close the year. Only once it has ended (in IST): leave taken on 31 December
   * is approved and debited from that year's balance, and a close before then
   * would carry days the person was about to spend.
   */
  async close(actor: Actor, input: LeaveYearEndInput): Promise<LeaveYearEndView> {
    this.assertMayClose(actor);
    if (input.year >= thisYear()) {
      throw validationFailed([{
        field: 'year',
        message: `${input.year} has not ended yet. It can be closed from 1 January ${input.year + 1}.`,
      }]);
    }
    return this.run(actor, input.year, false);
  }

  /**
   * `leave.manage` gets you here (the controller checks it); closing also moves
   * — and lists — the balances of everyone in the company, so it needs the
   * company-wide view too. Without it, HR scoped to a team could read every
   * balance from the preview.
   */
  private assertMayClose(actor: Actor): void {
    if (!can(actor, 'leave.view.all')) {
      throw new ForbiddenException({
        code: 'NEEDS_LEAVE_VIEW_ALL',
        message: 'Closing the leave year moves everyone\'s balance, so it needs permission to view all leave as well.',
      });
    }
  }

  private async run(actor: Actor, year: number, dryRun: boolean): Promise<LeaveYearEndView> {
    try {
      return await withTenant(this.db, actor.tenantId, async (tx) => {
        const result = await closeYear(tx, actor, year, dryRun);
        if (dryRun) throw new DryRun(result);

        await this.audit.record(tx, actor, {
          entity: 'leave_year_end', action: 'CLOSE',
          after: {
            year,
            creditsPosted: result.creditsPosted,
            people: result.people,
            types: result.types
              .filter((t) => t.people > 0)
              .map((t) => ({ code: t.leaveType.code, carried: t.carriedDays, encashed: t.encashedDays, lapsed: t.lapsedDays })),
            skipped: result.skipped.length,
          },
        });
        return result;
      });
    } catch (error) {
      if (error instanceof DryRun) return error.result;
      throw error;
    }
  }
}

async function closeYear(tx: TenantDatabase, actor: Actor, year: number, dryRun: boolean): Promise<LeaveYearEndView> {
  // Lock every employee before reading a single balance — the lock every other
  // change to someone's leave takes first. Without it, an approval landing
  // between this read and the writes below would debit days already carried,
  // and two closes at once would each carry the same balance. In id order, so
  // two closes queue rather than deadlock.
  await tx.select({ id: employee.id }).from(employee)
    .where(isNull(employee.deletedAt))
    .orderBy(asc(employee.id))
    .for('no key update');

  // December's accrual, or a grant nobody posted, would otherwise land in the
  // old year after it was closed. Posting is idempotent, so this only fills gaps.
  const { posted: creditsPosted } = await postCredits(tx, actor, payrollMonth(`${year}-12`));

  const types = await tx.select().from(leaveType).where(eq(leaveType.isPaid, true)).orderBy(asc(leaveType.code));
  const typeById = new Map(types.map((t) => [t.id, t]));

  const balances = await tx.select({
    employeeId: leaveTxn.employeeId,
    leaveTypeId: leaveTxn.leaveTypeId,
    balance: sql<number>`sum(${leaveTxn.daysHundredths})::int`,
    carried: sql<number>`coalesce(-sum(${leaveTxn.daysHundredths}) filter (where ${leaveTxn.kind} = 'CARRY_OUT'), 0)::int`,
    encashed: sql<number>`coalesce(-sum(${leaveTxn.daysHundredths}) filter (where ${leaveTxn.kind} = 'ENCASHMENT'), 0)::int`,
  }).from(leaveTxn)
    .where(eq(leaveTxn.calendarYear, year))
    .groupBy(leaveTxn.employeeId, leaveTxn.leaveTypeId);

  const pendingRows = await tx.select({
    employeeId: leaveRequest.employeeId,
    leaveTypeId: leaveRequest.leaveTypeId,
    days: sql<number>`sum(${leaveRequest.daysHundredths})::int`,
  }).from(leaveRequest)
    .where(and(eq(leaveRequest.status, 'PENDING'), ...inYear(year)))
    .groupBy(leaveRequest.employeeId, leaveRequest.leaveTypeId);
  const pending = new Map(pendingRows.map((r) => [`${r.employeeId}:${r.leaveTypeId}`, r.days]));

  const people = await tx.select({
    id: employee.id, empCode: employee.empCode, firstName: employee.firstName, lastName: employee.lastName,
    exitDate: employee.exitDate,
  }).from(employee).where(isNull(employee.deletedAt));
  const personById = new Map(people.map((p) => [p.id, p]));

  const nextYearStarts = `${year + 1}-01-01`;
  const rows: LedgerRow[] = [];
  const skipped: LeaveYearEndView['skipped'] = [];
  const moved = new Map<string, { people: Set<string>; carried: number; encashed: number; lapsed: number }>();
  const movers = new Set<string>();

  for (const b of balances) {
    const type = typeById.get(b.leaveTypeId);
    // Gone: an anonymised employee (D-19), whose record shows nowhere now.
    const person = personById.get(b.employeeId);
    if (!type || !person || b.balance === 0) continue;

    const skip = (reason: YearEndSkipReason) => skipped.push({
      employee: { id: person.id, empCode: person.empCode, name: [person.firstName, person.lastName].filter(Boolean).join(' ') },
      leaveType: { id: type.id, code: type.code, name: type.name },
      reason,
      balanceDays: days(b.balance),
      pendingDays: days(pending.get(`${b.employeeId}:${b.leaveTypeId}`) ?? 0),
    });

    // Left during the year: what they have is full-and-final settlement's to
    // pay or recover (PAY-08), not this year's to carry into a year they are
    // not here for — and not to lapse before it is settled.
    if (person.exitDate !== null && person.exitDate < nextYearStarts) {
      skip('EXITED');
      continue;
    }
    // A decision still to come would debit the old year after its days had
    // moved on. Decide it, then close again.
    if (pending.has(`${b.employeeId}:${b.leaveTypeId}`)) {
      skip('PENDING_REQUESTS');
      continue;
    }
    if (b.balance < 0) {
      skip('OVERDRAWN');
      continue;
    }

    const split = yearEndSplit(dayHundredths(b.balance), ruleOf(type), {
      carried: dayHundredths(b.carried),
      encashed: dayHundredths(b.encashed),
    });

    const reason = `${year} year end: ${describeRule(type)}`;
    const entry = (calendarYear: number, kind: LedgerRow['kind'], amount: number): void => {
      if (amount !== 0) {
        rows.push({
          tenantId: actor.tenantId, employeeId: person.id, leaveTypeId: type.id,
          calendarYear, kind, daysHundredths: amount, reason, createdBy: actor.userId,
        });
      }
    };
    entry(year, 'CARRY_OUT', -split.carry);
    entry(year + 1, 'CARRY_IN', split.carry);
    entry(year, 'ENCASHMENT', -split.encash);
    entry(year, 'LAPSE', -split.lapse);

    const totals = moved.get(type.id) ?? { people: new Set<string>(), carried: 0, encashed: 0, lapsed: 0 };
    totals.people.add(person.id);
    totals.carried += split.carry;
    totals.encashed += split.encash;
    totals.lapsed += split.lapse;
    moved.set(type.id, totals);
    movers.add(person.id);
  }

  await insertLedgerRows(tx, rows);

  return {
    year,
    yearEnded: year < thisYear(),
    dryRun,
    creditsPosted,
    people: movers.size,
    types: types
      .filter((t) => t.isActive || moved.has(t.id))
      .map((t) => {
        const totals = moved.get(t.id);
        return {
          leaveType: { id: t.id, code: t.code, name: t.name },
          carryForwardMaxDays: t.carryForwardMaxHundredths === null ? null : days(t.carryForwardMaxHundredths),
          encashMaxDays: days(t.encashMaxHundredths),
          people: totals?.people.size ?? 0,
          carriedDays: days(totals?.carried ?? 0),
          encashedDays: days(totals?.encashed ?? 0),
          lapsedDays: days(totals?.lapsed ?? 0),
        };
      }),
    skipped: skipped.sort((a, b) => a.employee.empCode.localeCompare(b.employee.empCode) || a.leaveType.code.localeCompare(b.leaveType.code)),
  };
}

function ruleOf(type: LeaveType): YearEndRule {
  return {
    carryForwardMax: type.carryForwardMaxHundredths === null ? null : dayHundredths(type.carryForwardMaxHundredths),
    encashMax: dayHundredths(type.encashMaxHundredths),
  };
}

/** "carries up to 30 days, encashes up to 5" — kept with each entry, so the history says which rule did it. */
function describeRule(type: LeaveType): string {
  const quantity = (h: number) => `${formatDays(h as DayHundredths)} ${h === 100 || h === 50 ? 'day' : 'days'}`;
  const carry = type.carryForwardMaxHundredths === null
    ? 'carries in full'
    : type.carryForwardMaxHundredths === 0 ? 'carries nothing' : `carries up to ${quantity(type.carryForwardMaxHundredths)}`;
  const encash = type.encashMaxHundredths === 0 ? '' : `, encashes up to ${quantity(type.encashMaxHundredths)}`;
  return `${type.name} ${carry}${encash}`;
}

/** The leave year it is now, in IST. */
function thisYear(): number {
  return leaveYearOf(toIstDate(new Date()));
}
