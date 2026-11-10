import { Injectable, Inject, ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import {
  leaveRequest, leaveTxn, leaveType, withTenant,
  type Database, type LeaveTxn,
} from '@peoplepulse/db';
import { fromDays, payrollMonth, payrollMonthOf, toIstDate, type Actor } from '@peoplepulse/core';
import { DB } from '../../platform/database/database.module';
import { AuditService } from '../../platform/audit/audit.service';
import { validationFailed } from '../../platform/validation/zod.pipe';
import { findVisibleEmployee, inYear, lockEmployee } from './leave-access';
import { postCredits } from './leave-credits';
import {
  days, type LeaveAdjustmentInput, type LeaveBalanceView, type LeaveLedgerEntryView, type PostAccrualsInput,
} from './leave.dto';

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
        // One accrual run or year-end close writes all its rows in one
        // transaction, and `now()` is the transaction's start, so they share a
        // timestamp. Type and period then put January before February, and the
        // kind — in enum order — puts a close's carry before its encashment
        // before its lapse.
        .orderBy(
          asc(leaveTxn.createdAt), asc(leaveType.code), asc(leaveTxn.accrualPeriod), asc(leaveTxn.kind), asc(leaveTxn.id),
        );

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
   * Idempotent and catching up — see `postCredits`.
   */
  async postAccruals(actor: Actor, input: PostAccrualsInput): Promise<{ through: string; posted: number; alreadyPosted: number }> {
    const through = payrollMonth(input.through);
    if (through > payrollMonthOf(toIstDate(new Date()))) {
      throw validationFailed([{ field: 'through', message: 'That month has not started yet' }]);
    }

    return withTenant(this.db, actor.tenantId, async (tx) => {
      const { posted, alreadyPosted } = await postCredits(tx, actor, through);
      await this.audit.record(tx, actor, {
        entity: 'leave_accrual', action: 'POST', after: { through, posted, alreadyPosted },
      });
      return { through, posted, alreadyPosted };
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
