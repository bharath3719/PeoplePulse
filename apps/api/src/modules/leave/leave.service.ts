import {
  Injectable, Inject, ConflictException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gte, isNull, lte, type SQL } from 'drizzle-orm';
import {
  employee, leaveRequest, leaveTxn, leaveType, withTenant,
  type Database, type Employee, type LeaveRequest, type LeaveType, type TenantDatabase,
} from '@peoplepulse/db';
import {
  assertValidSpan, countLeaveDays, formatDays, isPartDay, leaveYearOfSpan, LeaveSpanError, spansOverlap,
  toIstDate, toLeaveSpan, dayHundredths,
  type Actor, type DayHundredths, type LeaveSpan,
} from '@peoplepulse/core';
import { DB } from '../../platform/database/database.module';
import { AuditService } from '../../platform/audit/audit.service';
import { validationFailed } from '../../platform/validation/zod.pipe';
import {
  inYear, isLive, ledgerBalance, lockEmployee, mayDecide, ownEmployee, pendingDays, visibleEmployees,
  workingCalendarFor,
} from './leave-access';
import {
  days,
  type ApplyLeaveInput, type LeaveDecisionInput, type LeavePreview, type LeaveRequestView, type PreviewLeaveInput,
} from './leave.dto';

interface Evaluated {
  type: LeaveType;
  span: LeaveSpan;
  daysHundredths: DayHundredths;
  preview: LeavePreview;
}

/**
 * Leave requests (LVE-03, LVE-05): apply, approve or reject, cancel.
 *
 * Every change to one person's leave runs under a lock on their employee row
 * (`ownEmployee` / `lockEmployee`), taken first, always. That is what lets
 * a balance check be trusted: two requests, or a request and an approval, for
 * the same person cannot both read a balance before either has changed it.
 */
@Injectable()
export class LeaveService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** What a request would cost, checked exactly as applying checks it, and written nowhere. */
  async preview(actor: Actor, input: PreviewLeaveInput): Promise<LeavePreview> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const me = await ownEmployee(tx, actor);
      return (await this.evaluate(tx, actor, me, input)).preview;
    });
  }

  async apply(actor: Actor, input: ApplyLeaveInput): Promise<LeaveRequestView> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const me = await ownEmployee(tx, actor, { lock: true });
      const { type, span, daysHundredths } = await this.evaluate(tx, actor, me, input);

      const [created] = await tx.insert(leaveRequest).values({
        tenantId: actor.tenantId,
        employeeId: me.id,
        leaveTypeId: type.id,
        startDate: span.startDate,
        startSession: span.startSession,
        endDate: span.endDate,
        endSession: span.endSession,
        daysHundredths,
        reason: input.reason || null,
        createdBy: actor.userId,
      }).returning();

      await this.audit.record(tx, actor, {
        entity: 'leave_request', entityId: created!.id, action: 'CREATE',
        after: { leaveType: type.code, startDate: span.startDate, endDate: span.endDate, days: days(daysHundredths) },
      });

      return toRequestView(actor, created!, me, type);
    });
  }

  /**
   * Every request the actor may see: their own, and their scope's. Each row says
   * whether they may decide or cancel it, so the client never works that out.
   */
  async list(actor: Actor, filter: { status?: LeaveRequest['status'] | undefined; year?: number | undefined }): Promise<LeaveRequestView[]> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(employee.deletedAt)];
      const scoped = visibleEmployees(actor);
      if (scoped) conditions.push(scoped);
      if (filter.status) conditions.push(eq(leaveRequest.status, filter.status));
      if (filter.year) conditions.push(...inYear(filter.year));

      const rows = await tx.select({ request: leaveRequest, employee, type: leaveType })
        .from(leaveRequest)
        .innerJoin(employee, eq(employee.id, leaveRequest.employeeId))
        .innerJoin(leaveType, eq(leaveType.id, leaveRequest.leaveTypeId))
        .where(and(...conditions))
        .orderBy(desc(leaveRequest.startDate), desc(leaveRequest.createdAt))
        .limit(200);

      return rows.map((r) => toRequestView(actor, r.request, r.employee, r.type));
    });
  }

  /**
   * Approve or reject (LVE-03). One level for now: the employee's manager, or
   * anyone with company-wide leave access. Never the employee themselves.
   *
   * Approving re-checks the balance, because it can have moved since the
   * request was made — an HR adjustment, another approval — and it is the
   * approval, not the request, that takes the days.
   */
  async decide(actor: Actor, id: string, input: LeaveDecisionInput): Promise<LeaveRequestView> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [found] = await tx.select({ employeeId: leaveRequest.employeeId })
        .from(leaveRequest).where(eq(leaveRequest.id, id));
      if (!found) throw new NotFoundException('Leave request not found');

      const subject = await lockEmployee(tx, found.employeeId);
      if (!subject) throw new NotFoundException('Leave request not found');
      if (subject.id === actor.employeeId) {
        throw new ForbiddenException({
          code: 'OWN_LEAVE',
          message: 'You cannot approve or reject your own leave.',
        });
      }
      // Outside your team reads the same as not existing, as it does everywhere.
      if (!mayDecide(actor, subject)) throw new NotFoundException('Leave request not found');

      const request = await this.lockRequest(tx, id);
      if (request.status !== 'PENDING') {
        throw new ConflictException({
          code: 'ALREADY_DECIDED',
          message: `This request has already been ${request.status.toLowerCase()}.`,
        });
      }

      const [type] = await tx.select().from(leaveType).where(eq(leaveType.id, request.leaveTypeId));
      const year = Number(request.startDate.slice(0, 4));

      if (input.decision === 'APPROVE' && type!.isPaid) {
        const balance = await ledgerBalance(tx, subject.id, type!.id, year);
        if (balance < request.daysHundredths) {
          throw new ConflictException({
            code: 'INSUFFICIENT_BALANCE',
            message: `${subject.firstName} has ${formatDays(balance)} days of ${type!.name} left for ${year}, `
              + `and this request is ${formatDays(dayHundredths(request.daysHundredths))}.`,
          });
        }
        await tx.insert(leaveTxn).values({
          tenantId: actor.tenantId,
          employeeId: subject.id,
          leaveTypeId: type!.id,
          calendarYear: year,
          kind: 'DEBIT',
          daysHundredths: -request.daysHundredths,
          leaveRequestId: request.id,
          createdBy: actor.userId,
        });
      }

      const [updated] = await tx.update(leaveRequest).set({
        status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        decidedByUserId: actor.userId,
        decidedAt: new Date(),
        decisionNote: input.note || null,
        updatedAt: new Date(),
      }).where(eq(leaveRequest.id, id)).returning();

      await this.audit.record(tx, actor, {
        entity: 'leave_request', entityId: id, action: input.decision,
        before: { status: 'PENDING' },
        after: { status: updated!.status, note: input.note },
      });

      return toRequestView(actor, updated!, subject, type!);
    });
  }

  /**
   * Withdraw your own request. Pending: always. Approved: only before it starts,
   * and the days go back on the ledger. Once it has started, changing it changes
   * attendance that may already be counted, and that is HR's to do.
   */
  async cancel(actor: Actor, id: string): Promise<LeaveRequestView> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const me = await ownEmployee(tx, actor, { lock: true });
      const [found] = await tx.select({ id: leaveRequest.id }).from(leaveRequest)
        .where(and(eq(leaveRequest.id, id), eq(leaveRequest.employeeId, me.id)));
      if (!found) throw new NotFoundException('Leave request not found');

      const request = await this.lockRequest(tx, id);
      const [type] = await tx.select().from(leaveType).where(eq(leaveType.id, request.leaveTypeId));

      if (request.status === 'APPROVED') {
        if (request.startDate <= toIstDate(new Date())) {
          throw new ConflictException({
            code: 'ALREADY_STARTED',
            message: 'This leave has already started, so it cannot be cancelled here. Ask HR to change it.',
          });
        }
        if (type!.isPaid) {
          await tx.insert(leaveTxn).values({
            tenantId: actor.tenantId,
            employeeId: me.id,
            leaveTypeId: type!.id,
            calendarYear: Number(request.startDate.slice(0, 4)),
            kind: 'REVERSAL',
            daysHundredths: request.daysHundredths,
            leaveRequestId: request.id,
            createdBy: actor.userId,
          });
        }
      } else if (request.status !== 'PENDING') {
        throw new ConflictException({
          code: 'ALREADY_DECIDED',
          message: `This request has already been ${request.status.toLowerCase()}.`,
        });
      }

      const [updated] = await tx.update(leaveRequest).set({
        status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date(),
      }).where(eq(leaveRequest.id, id)).returning();

      await this.audit.record(tx, actor, {
        entity: 'leave_request', entityId: id, action: 'CANCEL',
        before: { status: request.status }, after: { status: 'CANCELLED' },
      });

      return toRequestView(actor, updated!, me, type!);
    });
  }

  /**
   * Everything a request must pass, in the order a person would want to hear
   * about it. Field errors for what they can fix in the form; a 409 for what is
   * true of their leave rather than of the form (an overlap, a short balance).
   */
  private async evaluate(
    tx: TenantDatabase, actor: Actor, me: Employee, input: PreviewLeaveInput,
  ): Promise<Evaluated> {
    const [type] = await tx.select().from(leaveType)
      .where(and(eq(leaveType.id, input.leaveTypeId), eq(leaveType.isActive, true)));
    if (!type) throw validationFailed([{ field: 'leaveTypeId', message: 'Pick one of the leave types offered here' }]);

    const span = toLeaveSpan(input);
    try {
      assertValidSpan(span);
    } catch (error) {
      if (error instanceof LeaveSpanError) throw validationFailed([{ field: 'endDate', message: error.message }]);
      throw error;
    }

    if (span.startDate < me.joinDate) {
      throw validationFailed([{ field: 'startDate', message: `That is before your joining date, ${me.joinDate}` }]);
    }
    if (me.exitDate && span.endDate > me.exitDate) {
      throw validationFailed([{ field: 'endDate', message: `That is after your last working day, ${me.exitDate}` }]);
    }
    if (!type.allowsHalfDay && isPartDay(span)) {
      throw validationFailed([{ field: 'startSession', message: `${type.name} is taken in whole days` }]);
    }

    const year = leaveYearOfSpan(span);
    const calendar = await workingCalendarFor(tx, actor.tenantId, me.locationId, year);
    const daysHundredths = countLeaveDays(span, type.dayCountBasis, calendar);
    if (daysHundredths === 0) {
      throw validationFailed([{ field: 'startDate', message: 'Those days are all weekly offs or holidays — there is no leave to take' }]);
    }

    // By session, so a morning and an afternoon on one date are two requests.
    const nearby = await tx.select().from(leaveRequest).where(and(
      eq(leaveRequest.employeeId, me.id),
      isLive(),
      lte(leaveRequest.startDate, span.endDate),
      gte(leaveRequest.endDate, span.startDate),
    ));
    const clash = nearby.find((other) => spansOverlap(span, toLeaveSpan(other)));
    if (clash) {
      throw new ConflictException({
        code: 'LEAVE_OVERLAP',
        message: `You already have ${clash.status.toLowerCase()} leave from ${clash.startDate} to ${clash.endDate}.`,
      });
    }

    if (!type.isPaid) {
      return {
        type, span, daysHundredths,
        preview: { days: days(daysHundredths), isPaid: false, balanceDays: null, pendingDays: null, availableAfterDays: null },
      };
    }

    const balance = await ledgerBalance(tx, me.id, type.id, year);
    const pending = await pendingDays(tx, me.id, type.id, year);
    const available = balance - pending;
    if (daysHundredths > available) {
      throw new ConflictException({
        code: 'INSUFFICIENT_BALANCE',
        message: `This is ${formatDays(daysHundredths)} days of ${type.name}, and you have `
          + `${formatDays(dayHundredths(available))} available for ${year}`
          + (pending > 0 ? ` (${formatDays(pending)} more already requested).` : '.'),
      });
    }

    return {
      type, span, daysHundredths,
      preview: {
        days: days(daysHundredths),
        isPaid: true,
        balanceDays: days(balance),
        pendingDays: days(pending),
        availableAfterDays: days(available - daysHundredths),
      },
    };
  }

  private async lockRequest(tx: TenantDatabase, id: string): Promise<LeaveRequest> {
    const [request] = await tx.select().from(leaveRequest).where(eq(leaveRequest.id, id)).for('update');
    if (!request) throw new NotFoundException('Leave request not found');
    return request;
  }
}

function toRequestView(actor: Actor, request: LeaveRequest, subject: Employee, type: LeaveType): LeaveRequestView {
  const own = subject.id === actor.employeeId;
  const today = toIstDate(new Date());
  return {
    id: request.id,
    employee: {
      id: subject.id,
      empCode: subject.empCode,
      name: [subject.firstName, subject.lastName].filter(Boolean).join(' '),
    },
    leaveType: { id: type.id, code: type.code, name: type.name },
    startDate: request.startDate,
    startSession: request.startSession,
    endDate: request.endDate,
    endSession: request.endSession,
    days: days(request.daysHundredths),
    reason: request.reason,
    status: request.status,
    decisionNote: request.decisionNote,
    decidedAt: request.decidedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    canDecide: request.status === 'PENDING' && mayDecide(actor, subject),
    canCancel: own && (request.status === 'PENDING' || (request.status === 'APPROVED' && request.startDate > today)),
  };
}
