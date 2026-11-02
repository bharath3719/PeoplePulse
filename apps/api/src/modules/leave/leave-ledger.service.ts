import { Injectable, Inject, ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import {
  employee, leaveRequest, leaveTxn, leaveType, withTenant,
  type Database, type LeaveTxn,
} from '@peoplepulse/db';
import {
  dayHundredths, fromDays, istDate, lastDayOfMonth, monthlyAccrual, payrollMonth, payrollMonthOf, toIstDate,
  yearlyGrant, type Actor, type LeaveYear, type Tenure,
} from '@peoplepulse/core';
import { DB } from '../../platform/database/database.module';
import { AuditService } from '../../platform/audit/audit.service';
import { validationFailed } from '../../platform/validation/zod.pipe';
import { findVisibleEmployee, inYear, lockEmployee } from './leave-access';
import {
  days, type LeaveAdjustmentInput, type LeaveBalanceView, type LeaveLedgerEntryView, type PostAccrualsInput,
} from './leave.dto';

/** Postgres takes at most 65,535 bind parameters per statement; a ledger row uses 8. */
const INSERT_BATCH = 1_000;

/**
 * The leave ledger (TR-15): balances, the history behind them, and the two
 * ways HR puts days into it — accruals, and adjustments.
 *
 * Nothing here edits a balance, because there is no balance column to edit. A
 * balance is the sum of `leave_txn` for one person, type and calendar year, and
 * every change is a new row with a kind and, when a person made it, a reason.
 */
@Injectable()
export class LeaveLedgerService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async balances(actor: Actor, employeeId: string, year: number): Promise<LeaveBalanceView[]> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      await findVisibleEmployee(tx, actor, employeeId);

      const ledger = tx.select({
        leaveTypeId: leaveTxn.leaveTypeId,
        total: sql<number>`sum(${leaveTxn.daysHundredths})::int`.as('ledger_total'),
      }).from(leaveTxn)
        .where(and(eq(leaveTxn.employeeId, employeeId), eq(leaveTxn.calendarYear, year)))
        .groupBy(leaveTxn.leaveTypeId)
        .as('ledger');

      const requests = tx.select({
        leaveTypeId: leaveRequest.leaveTypeId,
        pending: sql<number>`sum(${leaveRequest.daysHundredths}) filter (where ${leaveRequest.status} = 'PENDING')::int`.as('pending'),
        taken: sql<number>`sum(${leaveRequest.daysHundredths}) filter (where ${leaveRequest.status} = 'APPROVED')::int`.as('taken'),
      }).from(leaveRequest)
        .where(and(eq(leaveRequest.employeeId, employeeId), ...inYear(year)))
        .groupBy(leaveRequest.leaveTypeId)
        .as('requests');

      // Every active type, plus any retired type this person still has days or
      // history in — retiring a type must not make a balance vanish from view.
      const rows = await tx.select({
        type: leaveType,
        ledgerTotal: ledger.total,
        pending: requests.pending,
        taken: requests.taken,
      }).from(leaveType)
        .leftJoin(ledger, eq(ledger.leaveTypeId, leaveType.id))
        .leftJoin(requests, eq(requests.leaveTypeId, leaveType.id))
        .where(or(eq(leaveType.isActive, true), sql`${ledger.total} is not null`, sql`${requests.taken} is not null`))
        .orderBy(asc(leaveType.code));

      return rows.map((r) => {
        const balance = r.type.isPaid ? (r.ledgerTotal ?? 0) : null;
        const pending = r.pending ?? 0;
        return {
          leaveType: { id: r.type.id, code: r.type.code, name: r.type.name, isPaid: r.type.isPaid },
          calendarYear: year,
          balanceDays: balance === null ? null : days(balance),
          pendingDays: days(pending),
          availableDays: balance === null ? null : days(balance - pending),
          takenDays: days(r.taken ?? 0),
        };
      });
    });
  }

  /** Line by line, the answer to "why do I have this many days?". */
  async ledger(actor: Actor, employeeId: string, year: number): Promise<LeaveLedgerEntryView[]> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      await findVisibleEmployee(tx, actor, employeeId);

      const rows = await tx.select({
        txn: leaveTxn,
        type: { id: leaveType.id, code: leaveType.code, name: leaveType.name },
        request: { id: leaveRequest.id, startDate: leaveRequest.startDate, endDate: leaveRequest.endDate },
      }).from(leaveTxn)
        .innerJoin(leaveType, eq(leaveType.id, leaveTxn.leaveTypeId))
        .leftJoin(leaveRequest, eq(leaveRequest.id, leaveTxn.leaveRequestId))
        .where(and(eq(leaveTxn.employeeId, employeeId), eq(leaveTxn.calendarYear, year)))
        // One accrual run writes all its rows in one transaction, and `now()` is
        // the transaction's start, so they share a timestamp. Type and period
        // then put January before February.
        .orderBy(asc(leaveTxn.createdAt), asc(leaveType.code), asc(leaveTxn.accrualPeriod), asc(leaveTxn.id));

      return rows.map((r) => toEntryView(r.txn, r.type, r.request));
    });
  }

  /**
   * A manual entry, with its reason (LVE-08, TR-15): an OPENING balance carried
   * in at go-live, or an ADJUSTMENT. The only way a person changes a balance by
   * hand, and never their own — `leave.manage` is not a licence to grant
   * yourself days.
   */
  async adjust(actor: Actor, input: LeaveAdjustmentInput): Promise<LeaveLedgerEntryView> {
    if (input.employeeId === actor.employeeId) {
      throw new ForbiddenException({
        code: 'OWN_BALANCE',
        message: 'You cannot change your own leave balance. Someone else with leave admin can.',
      });
    }

    return withTenant(this.db, actor.tenantId, async (tx) => {
      // Visible first, so a miss says nothing about who exists beyond the
      // caller's scope; then locked, like every other change to their leave.
      await findVisibleEmployee(tx, actor, input.employeeId);
      if (!(await lockEmployee(tx, input.employeeId))) throw new NotFoundException('Employee not found');

      const [type] = await tx.select().from(leaveType).where(eq(leaveType.id, input.leaveTypeId));
      if (!type) throw validationFailed([{ field: 'leaveTypeId', message: 'Pick one of this company\'s leave types' }]);
      if (!type.isPaid) {
        throw validationFailed([{ field: 'leaveTypeId', message: `${type.name} is unpaid, so it has no balance to adjust` }]);
      }

      const [entry] = await tx.insert(leaveTxn).values({
        tenantId: actor.tenantId,
        employeeId: input.employeeId,
        leaveTypeId: type.id,
        calendarYear: input.calendarYear,
        kind: input.kind,
        daysHundredths: fromDays(input.days),
        reason: input.reason,
        createdBy: actor.userId,
      }).returning();

      await this.audit.record(tx, actor, {
        entity: 'leave_txn', entityId: entry!.id, action: input.kind,
        after: {
          employeeId: input.employeeId, leaveType: type.code, calendarYear: input.calendarYear,
          days: input.days, reason: input.reason,
        },
      });

      return toEntryView(entry!, { id: type.id, code: type.code, name: type.name }, null);
    });
  }

  /**
   * Post the leave year's accruals and grants, up to and including `through`
   * (TR-15). Run by HR for now; the worker will run the same thing monthly.
   *
   * IDEMPOTENT, and catching up: every month of the year up to `through` that
   * is missing a credit gets one, and none gets two — the ledger's unique index
   * on (employee, type, period) turns a repeat into a no-op. So running October
   * after forgetting September posts both, and running it twice posts once.
   *
   * Credits are computed from today's join and exit dates and today's
   * entitlement. One already posted is not recomputed when either changes
   * later (OPEN.md D-24).
   */
  async postAccruals(actor: Actor, input: PostAccrualsInput): Promise<{ through: string; posted: number; alreadyPosted: number }> {
    const through = payrollMonth(input.through);
    if (through > payrollMonthOf(toIstDate(new Date()))) {
      throw validationFailed([{ field: 'through', message: 'That month has not started yet' }]);
    }
    const year = Number(through.slice(0, 4)) as LeaveYear;
    const lastMonth = Number(through.slice(5, 7));

    return withTenant(this.db, actor.tenantId, async (tx) => {
      const types = await tx.select().from(leaveType).where(and(
        eq(leaveType.isActive, true),
        eq(leaveType.isPaid, true),
        ne(leaveType.accrualFrequency, 'NONE'),
      ));

      const people = await tx.select({ id: employee.id, joinDate: employee.joinDate, exitDate: employee.exitDate })
        .from(employee)
        .where(and(
          isNull(employee.deletedAt),
          lte(employee.joinDate, lastDayOfMonth(through)),
          or(isNull(employee.exitDate), gte(employee.exitDate, `${year}-01-01`)),
        ));

      const rows: (typeof leaveTxn.$inferInsert)[] = [];
      for (const person of people) {
        const tenure: Tenure = {
          joinDate: istDate(person.joinDate),
          exitDate: person.exitDate ? istDate(person.exitDate) : null,
        };
        const credit = (kind: 'GRANT' | 'ACCRUAL', period: string, amount: number, typeId: string) => {
          if (amount > 0) {
            rows.push({
              tenantId: actor.tenantId, employeeId: person.id, leaveTypeId: typeId,
              calendarYear: year, kind, daysHundredths: amount, accrualPeriod: period, createdBy: actor.userId,
            });
          }
        };

        for (const type of types) {
          const annual = dayHundredths(type.annualEntitlementHundredths);
          if (type.accrualFrequency === 'YEARLY') {
            credit('GRANT', String(year), yearlyGrant(annual, year, tenure, type.proRataOnJoin), type.id);
          } else {
            for (let m = 1; m <= lastMonth; m += 1) {
              const month = payrollMonth(`${year}-${String(m).padStart(2, '0')}`);
              credit('ACCRUAL', month, monthlyAccrual(annual, month, tenure), type.id);
            }
          }
        }
      }

      let posted = 0;
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const inserted = await tx.insert(leaveTxn).values(rows.slice(i, i + INSERT_BATCH))
          .onConflictDoNothing()
          .returning({ id: leaveTxn.id });
        posted += inserted.length;
      }

      await this.audit.record(tx, actor, {
        entity: 'leave_accrual', action: 'POST',
        after: { through, posted, alreadyPosted: rows.length - posted },
      });
      return { through, posted, alreadyPosted: rows.length - posted };
    });
  }
}

function toEntryView(
  txn: LeaveTxn,
  type: { id: string; code: string; name: string },
  request: { id: string; startDate: string; endDate: string } | null,
): LeaveLedgerEntryView {
  return {
    id: txn.id,
    leaveType: type,
    kind: txn.kind,
    days: days(txn.daysHundredths),
    accrualPeriod: txn.accrualPeriod,
    reason: txn.reason,
    request,
    createdAt: txn.createdAt.toISOString(),
  };
}
