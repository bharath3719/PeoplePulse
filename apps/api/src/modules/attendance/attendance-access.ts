import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  employee, holiday, rosterAssignment, shift, tenant,
  type Employee, type RosterAssignment, type Shift, type TenantDatabase,
} from '@peoplepulse/db';
import {
  can, resolveScope, rosterOn, SCOPES,
  type Actor, type IstDate, type ShiftResolver,
} from '@peoplepulse/core';

/**
 * Who may see whose attendance, and the schedule a person works to. Shared by
 * every attendance service — and by leave, which counts the same weekly offs —
 * so each answer is written once.
 *
 * Seeing: your own (`attendance.view.own`), plus your direct reports with
 * `attendance.view.team`, or everyone with `attendance.view.all`. As with leave,
 * a manager keeps their own when their scope widens to the team.
 */
export function visibleEmployees(actor: Actor): SQL | undefined {
  const scope = resolveScope(actor, SCOPES.attendance);
  if (scope.kind === 'all') return undefined;

  const conditions: SQL[] = [];
  if (actor.employeeId && can(actor, 'attendance.view.own')) conditions.push(eq(employee.id, actor.employeeId));
  if (scope.kind === 'team') conditions.push(eq(employee.managerId, scope.managerEmployeeId));
  return conditions.length > 0 ? or(...conditions) : sql`false`;
}

/** An employee whose attendance the actor may see, or a 404 — the same 404 wherever they really are. */
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
 * The employee behind this login: people punch for themselves. Locked for a
 * punch, so that two clicks on one button are decided one after the other —
 * the second sees the first and is refused.
 */
export async function ownEmployee(tx: TenantDatabase, actor: Actor, opts: { lock?: boolean } = {}): Promise<Employee> {
  if (!actor.employeeId) throw notAnEmployee();
  const query = tx.select().from(employee)
    .where(and(eq(employee.id, actor.employeeId), isNull(employee.deletedAt)));
  // NO KEY UPDATE, as leave takes it: one person's attendance changes queue up
  // behind each other without blocking rows that merely point at them.
  const [found] = opts.lock ? await query.for('no key update') : await query;
  if (!found) throw notAnEmployee();
  return found;
}

function notAnEmployee(): ForbiddenException {
  // An accountant, or a founder who never added themselves as an employee.
  return new ForbiddenException({
    code: 'NOT_AN_EMPLOYEE',
    message: 'Your login is not linked to an employee record, so there is no one to punch in for.',
  });
}

/** A roster entry with the shift it names. */
export type RosterRow = RosterAssignment & { shift: Shift };

/**
 * Everything needed to say which shift, and which weekly offs, apply to one
 * person on any date up to `through`: their roster, and the company defaults
 * for the dates it does not cover.
 */
export interface Schedule {
  readonly roster: readonly RosterRow[];
  readonly defaultShift: Shift | null;
  readonly companyWeeklyOffDays: readonly number[];
}

/** One person's roster entries starting on or before a date, oldest first. */
export async function rosterRows(tx: TenantDatabase, employeeId: string, through: string): Promise<RosterRow[]> {
  const rows = await tx.select({ entry: rosterAssignment, shift })
    .from(rosterAssignment)
    .innerJoin(shift, eq(shift.id, rosterAssignment.shiftId))
    .where(and(eq(rosterAssignment.employeeId, employeeId), lte(rosterAssignment.effectiveFrom, through)))
    .orderBy(asc(rosterAssignment.effectiveFrom));
  return rows.map((r) => ({ ...r.entry, shift: r.shift }));
}

export async function scheduleFor(
  tx: TenantDatabase, tenantId: string, employeeId: string, through: string,
): Promise<Schedule> {
  const [company] = await tx.select({ weeklyOffDays: tenant.weeklyOffDays }).from(tenant).where(eq(tenant.id, tenantId));
  const [defaultShift] = await tx.select().from(shift).where(eq(shift.isDefault, true));
  return {
    roster: await rosterRows(tx, employeeId, through),
    defaultShift: defaultShift ?? null,
    companyWeeklyOffDays: company?.weeklyOffDays ?? [0],
  };
}

/** The shift someone works on a date: their roster entry's, or the company default's. */
export function shiftOn(schedule: Schedule, date: IstDate | string): Shift | null {
  return rosterOn(schedule.roster, date)?.shift ?? schedule.defaultShift;
}

/** The weekly offs in force on a date — the same answer leave's day count gets (core weeklyOffDaysOn). */
export function weeklyOffsOn(schedule: Schedule, date: IstDate | string): readonly number[] {
  return rosterOn(schedule.roster, date)?.weeklyOffDays ?? schedule.companyWeeklyOffDays;
}

export function shiftResolver(schedule: Schedule): ShiftResolver {
  return (date) => shiftOn(schedule, date);
}

/** Holidays at one location (and company-wide ones) between two dates, by date. */
export async function holidaysBetween(
  tx: TenantDatabase, locationId: string | null, from: string, to: string,
): Promise<Map<string, string>> {
  const rows = await tx.select({ date: holiday.date, name: holiday.name }).from(holiday).where(and(
    gte(holiday.date, from),
    lte(holiday.date, to),
    locationId ? or(isNull(holiday.locationId), eq(holiday.locationId, locationId)) : isNull(holiday.locationId),
  ));
  return new Map(rows.map((r) => [r.date, r.name]));
}
