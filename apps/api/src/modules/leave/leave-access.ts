import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  employee, holiday, leaveRequest, leaveTxn, tenant,
  type Employee, type TenantDatabase,
} from '@peoplepulse/db';
import {
  can, dayHundredths, resolveScope, SCOPES,
  type Actor, type DayHundredths, type LeaveYear, type WorkingCalendar,
} from '@peoplepulse/core';

/**
 * Who may see — and decide — whose leave. Shared by every leave service so the
 * answer is written once.
 *
 * Seeing: your own (`leave.view.own`), plus whatever `leave.view.team` or
 * `leave.view.all` add. Team means direct reports, as it does for employees.
 * Unlike the employee scope, a manager's own leave is not lost when their scope
 * widens to their team: they still need to see their balance to apply.
 */
export function visibleEmployees(actor: Actor): SQL | undefined {
  const scope = resolveScope(actor, SCOPES.leave);
  if (scope.kind === 'all') return undefined;

  const conditions: SQL[] = [];
  if (actor.employeeId && can(actor, 'leave.view.own')) conditions.push(eq(employee.id, actor.employeeId));
  if (scope.kind === 'team') conditions.push(eq(employee.managerId, scope.managerEmployeeId));
  return conditions.length > 0 ? or(...conditions) : sql`false`;
}

/**
 * Deciding: someone else's leave, within your scope. Never your own — even for
 * a Super Admin. Approving your own leave is choosing not to have LOP deducted
 * from your own pay, and no permission should mean that.
 */
export function mayDecide(actor: Actor, subject: Pick<Employee, 'id' | 'managerId'>): boolean {
  if (!can(actor, 'leave.approve') || subject.id === actor.employeeId) return false;
  const scope = resolveScope(actor, SCOPES.leave);
  return scope.kind === 'all' || (scope.kind === 'team' && subject.managerId === scope.managerEmployeeId);
}

/**
 * An employee the actor may see, or a 404 — the same answer whether they exist
 * in another company, in no company, or just outside your team. Optionally
 * locked; see `lockEmployee`.
 */
export async function findVisibleEmployee(
  tx: TenantDatabase, actor: Actor, employeeId: string, opts: { lock?: boolean } = {},
): Promise<Employee> {
  const conditions: SQL[] = [eq(employee.id, employeeId), isNull(employee.deletedAt)];
  const scoped = visibleEmployees(actor);
  if (scoped) conditions.push(scoped);

  const query = tx.select().from(employee).where(and(...conditions));
  const [found] = opts.lock ? await query.for('no key update') : await query;
  if (!found) throw new NotFoundException('Employee not found');
  return found;
}

/**
 * The employee behind this login. Leave is applied for and cancelled by the
 * person themselves, so this is where those start — locked, for any change.
 */
export async function ownEmployee(tx: TenantDatabase, actor: Actor, opts: { lock?: boolean } = {}): Promise<Employee> {
  if (!actor.employeeId) throw notAnEmployee();
  const found = opts.lock
    ? await lockEmployee(tx, actor.employeeId)
    : (await tx.select().from(employee)
      .where(and(eq(employee.id, actor.employeeId), isNull(employee.deletedAt))))[0];
  if (!found) throw notAnEmployee();
  return found;
}

/**
 * Lock an employee row before changing anything about their leave.
 *
 * The lock is what makes a balance check mean something. Without it, two
 * applications sent together each read the same balance, each find it enough,
 * and between them take twice what is there. NO KEY UPDATE, not UPDATE: it
 * serialises leave changes for this one person without blocking the foreign-key
 * checks of rows that merely point at them.
 */
export async function lockEmployee(tx: TenantDatabase, employeeId: string): Promise<Employee | undefined> {
  const [found] = await tx.select().from(employee)
    .where(and(eq(employee.id, employeeId), isNull(employee.deletedAt)))
    .for('no key update');
  return found;
}

function notAnEmployee(): ForbiddenException {
  // An accountant, or a founder who never added themselves as an employee.
  return new ForbiddenException({
    code: 'NOT_AN_EMPLOYEE',
    message: 'Your login is not linked to an employee record, so there is no one to take leave for.',
  });
}

/** The days a person was not due at work anyway, for one leave year. */
export async function workingCalendarFor(
  tx: TenantDatabase, tenantId: string, locationId: string | null, year: LeaveYear,
): Promise<WorkingCalendar> {
  const [company] = await tx.select({ weeklyOffDays: tenant.weeklyOffDays })
    .from(tenant).where(eq(tenant.id, tenantId));

  const rows = await tx.select({ date: holiday.date }).from(holiday).where(and(
    gte(holiday.date, `${year}-01-01`),
    lte(holiday.date, `${year}-12-31`),
    locationId ? or(isNull(holiday.locationId), eq(holiday.locationId, locationId)) : isNull(holiday.locationId),
  ));

  return {
    weeklyOffDays: company?.weeklyOffDays ?? [0],
    holidays: new Set(rows.map((r) => r.date)),
  };
}

/** A balance: the sum of the ledger. Never a stored number (TR-15). */
export async function ledgerBalance(
  tx: TenantDatabase, employeeId: string, leaveTypeId: string, year: number,
): Promise<DayHundredths> {
  const [row] = await tx.select({ total: sql<number>`coalesce(sum(${leaveTxn.daysHundredths}), 0)::int` })
    .from(leaveTxn)
    .where(and(
      eq(leaveTxn.employeeId, employeeId),
      eq(leaveTxn.leaveTypeId, leaveTypeId),
      eq(leaveTxn.calendarYear, year),
    ));
  return dayHundredths(row?.total ?? 0);
}

/**
 * Leave asked for and not yet decided. Not on the ledger — nothing has been
 * taken — but promised, so a new request must fit in what is left after it.
 */
export async function pendingDays(
  tx: TenantDatabase, employeeId: string, leaveTypeId: string, year: number,
): Promise<DayHundredths> {
  const [row] = await tx.select({ total: sql<number>`coalesce(sum(${leaveRequest.daysHundredths}), 0)::int` })
    .from(leaveRequest)
    .where(and(
      eq(leaveRequest.employeeId, employeeId),
      eq(leaveRequest.leaveTypeId, leaveTypeId),
      eq(leaveRequest.status, 'PENDING'),
      ...inYear(year),
    ));
  return dayHundredths(row?.total ?? 0);
}

/** Requests in a leave year. A request never straddles two (assertValidSpan), so its start decides. */
export function inYear(year: number): SQL[] {
  return [gte(leaveRequest.startDate, `${year}-01-01`), lte(leaveRequest.startDate, `${year}-12-31`)];
}

/** Requests that hold their dates: waiting for a decision, or approved. */
export function isLive(): SQL {
  return inArray(leaveRequest.status, ['PENDING', 'APPROVED']);
}
