import { Injectable, Inject, ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  employee, rosterAssignment, shift, withTenant,
  type Database, type Employee, type TenantDatabase,
} from '@peoplepulse/db';
import { can, rosterOn, toIstDate, type Actor } from '@peoplepulse/core';
import { DB } from '../../platform/database/database.module';
import { AuditService } from '../../platform/audit/audit.service';
import { validationFailed } from '../../platform/validation/zod.pipe';
import { findVisibleEmployee, scheduleFor, visibleEmployees } from './attendance-access';
import {
  toRosterEntryView, toShiftRef,
  type AssignRosterInput, type RosterEntryView, type RosterView,
} from './attendance.dto';

/**
 * Rosters (ATT-04): who works which shift, with which weekly offs, from when.
 *
 * Changing one is `attendance.manage`, for anyone whose attendance you can see —
 * except yourself. A roster decides which days you are due at work, and so
 * which days you can be absent from; moving your own weekly off onto the day
 * you did not come in is choosing not to be docked pay, as approving your own
 * leave would be.
 */
@Injectable()
export class RosterService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async forEmployee(actor: Actor, employeeId: string): Promise<RosterView> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const subject = await findVisibleEmployee(tx, actor, employeeId);
      const today = toIstDate(new Date());
      // Every entry, future ones included: a rotation is entered ahead.
      const schedule = await scheduleFor(tx, actor.tenantId, subject.id, '9999-12-31');
      const current = rosterOn(schedule.roster, today);

      return {
        employeeId: subject.id,
        today,
        current: current
          ? { shift: toShiftRef(current.shift), weeklyOffDays: current.weeklyOffDays, from: 'ROSTER' }
          : {
            shift: schedule.defaultShift ? toShiftRef(schedule.defaultShift) : null,
            weeklyOffDays: [...schedule.companyWeeklyOffDays],
            from: 'COMPANY',
          },
        entries: [...schedule.roster].reverse().map(toRosterEntryView),
        canManage: mayManage(actor, subject),
      };
    });
  }

  /** From `effectiveFrom`, until their next entry. An entry already on that date is replaced. */
  async assign(actor: Actor, input: AssignRosterInput): Promise<RosterEntryView> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const subject = await this.lockSubject(tx, actor, input.employeeId);

      // Asked under RLS, because the foreign key is not: Postgres checks it
      // without row-level security, so another company's shift id would pass.
      const [chosen] = await tx.select().from(shift).where(and(eq(shift.id, input.shiftId), eq(shift.isActive, true)));
      if (!chosen) throw validationFailed([{ field: 'shiftId', message: 'Pick one of this company\'s shifts' }]);

      if (input.effectiveFrom < subject.joinDate) {
        throw validationFailed([{ field: 'effectiveFrom', message: `That is before they joined, on ${subject.joinDate}` }]);
      }
      if (subject.exitDate && input.effectiveFrom > subject.exitDate) {
        throw validationFailed([{ field: 'effectiveFrom', message: `That is after their last working day, ${subject.exitDate}` }]);
      }

      const [replaced] = await tx.select().from(rosterAssignment).where(and(
        eq(rosterAssignment.employeeId, subject.id), eq(rosterAssignment.effectiveFrom, input.effectiveFrom),
      ));

      const [saved] = await tx.insert(rosterAssignment).values({
        tenantId: actor.tenantId,
        employeeId: subject.id,
        shiftId: chosen.id,
        effectiveFrom: input.effectiveFrom,
        weeklyOffDays: input.weeklyOffDays,
        createdBy: actor.userId,
      }).onConflictDoUpdate({
        target: [rosterAssignment.employeeId, rosterAssignment.effectiveFrom],
        set: { shiftId: chosen.id, weeklyOffDays: input.weeklyOffDays, updatedAt: new Date() },
      }).returning();

      await this.audit.record(tx, actor, {
        entity: 'roster_assignment', entityId: saved!.id, action: replaced ? 'UPDATE' : 'CREATE',
        ...(replaced && { before: { shiftId: replaced.shiftId, weeklyOffDays: replaced.weeklyOffDays } }),
        after: { employeeId: subject.id, shift: chosen.code, effectiveFrom: input.effectiveFrom, weeklyOffDays: input.weeklyOffDays },
      });
      return toRosterEntryView({ ...saved!, shift: chosen });
    });
  }

  /** The previous entry then runs on until the next one — or the company default, if it was the first. */
  async remove(actor: Actor, id: string): Promise<void> {
    await withTenant(this.db, actor.tenantId, async (tx) => {
      const [found] = await tx.select({ employeeId: rosterAssignment.employeeId })
        .from(rosterAssignment).where(eq(rosterAssignment.id, id));
      if (!found) throw new NotFoundException('Roster entry not found');

      await this.lockSubject(tx, actor, found.employeeId, 'Roster entry not found');
      const [removed] = await tx.delete(rosterAssignment).where(eq(rosterAssignment.id, id)).returning();
      if (!removed) throw new NotFoundException('Roster entry not found');

      await this.audit.record(tx, actor, {
        entity: 'roster_assignment', entityId: id, action: 'DELETE',
        before: { employeeId: removed.employeeId, shiftId: removed.shiftId, effectiveFrom: removed.effectiveFrom, weeklyOffDays: removed.weeklyOffDays },
      });
    });
  }

  /**
   * The employee whose roster is changing, locked, as every change to one
   * person's attendance or leave locks them first — leave counts the same
   * weekly offs, and must not count them halfway through a change.
   */
  private async lockSubject(tx: TenantDatabase, actor: Actor, employeeId: string, notFound = 'Employee not found'): Promise<Employee> {
    const [subject] = await tx.select().from(employee)
      .where(and(eq(employee.id, employeeId), isNull(employee.deletedAt), visibleEmployees(actor)))
      .for('no key update');
    if (!subject) throw new NotFoundException(notFound);
    if (subject.id === actor.employeeId) {
      throw new ForbiddenException({ code: 'OWN_ROSTER', message: 'You cannot change your own roster. Ask someone else in HR.' });
    }
    return subject;
  }
}

function mayManage(actor: Actor, subject: Pick<Employee, 'id'>): boolean {
  return can(actor, 'attendance.manage') && subject.id !== actor.employeeId;
}
