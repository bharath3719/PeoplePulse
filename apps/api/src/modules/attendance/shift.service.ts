import { Injectable, Inject, ConflictException, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { shift, withTenant, type Database, type NewShift } from '@peoplepulse/db';
import { DEFAULT_SHIFT, parseClock, type Actor } from '@peoplepulse/core';
import { DB } from '../../platform/database/database.module';
import { AuditService } from '../../platform/audit/audit.service';
import { validationFailed } from '../../platform/validation/zod.pipe';
import {
  toShiftView, type CreateShiftInput, type ShiftView, type UpdateShiftInput,
} from './attendance.dto';

/** The standard shift as a row for one company — signup's default (TR-02). */
export function defaultShiftRow(tenantId: string, createdBy: string | null = null): NewShift {
  return { ...DEFAULT_SHIFT, tenantId, isDefault: true, createdBy };
}

/**
 * Shifts (ATT-04): the hours a company works. Who works which is the roster's
 * (RosterService); when they actually came is the punches' (PunchService).
 */
@Injectable()
export class ShiftService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor): Promise<ShiftView[]> {
    const rows = await withTenant(this.db, actor.tenantId, (tx) =>
      tx.select().from(shift).orderBy(desc(shift.isActive), desc(shift.isDefault), asc(shift.startMinute), asc(shift.code)));
    return rows.map(toShiftView);
  }

  /** The company's first shift becomes its default: until one exists, nobody has hours to be late for. */
  async create(actor: Actor, input: CreateShiftInput): Promise<ShiftView> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [taken] = await tx.select({ id: shift.id }).from(shift).where(eq(shift.code, input.code));
      if (taken) throw validationFailed([{ field: 'code', message: `${input.code} is already a shift here` }]);

      const [existingDefault] = await tx.select({ id: shift.id }).from(shift).where(eq(shift.isDefault, true));
      const [created] = await tx.insert(shift).values({
        tenantId: actor.tenantId,
        code: input.code,
        name: input.name,
        startMinute: parseClock(input.startTime),
        endMinute: parseClock(input.endTime),
        graceMinutes: input.graceMinutes,
        isDefault: !existingDefault,
        createdBy: actor.userId,
      }).returning();

      await this.audit.record(tx, actor, {
        entity: 'shift', entityId: created!.id, action: 'CREATE', after: { ...input, isDefault: created!.isDefault },
      });
      return toShiftView(created!);
    });
  }

  /**
   * New times apply to every day the shift is rostered on, until a month's
   * attendance is locked (ATT-09) — the lock, not this row, is what payroll
   * reads. The code never changes: rosters and reports match on it.
   */
  async update(actor: Actor, id: string, input: UpdateShiftInput): Promise<ShiftView> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [current] = await tx.select().from(shift).where(eq(shift.id, id)).for('update');
      if (!current) throw new NotFoundException('Shift not found');

      const startMinute = input.startTime !== undefined ? parseClock(input.startTime) : current.startMinute;
      const endMinute = input.endTime !== undefined ? parseClock(input.endTime) : current.endMinute;
      // The schema checks this when both times are sent; a PATCH may carry one.
      if (startMinute === endMinute) throw validationFailed([{ field: 'endTime', message: 'Ends when it starts' }]);

      if (input.isActive === false && current.isDefault) {
        throw new ConflictException({
          code: 'DEFAULT_SHIFT',
          message: `${current.name} is the default shift. Make another shift the default before switching this one off.`,
        });
      }

      const [updated] = await tx.update(shift).set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.graceMinutes !== undefined && { graceMinutes: input.graceMinutes }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        startMinute,
        endMinute,
        updatedAt: new Date(),
      }).where(eq(shift.id, id)).returning();

      await this.audit.record(tx, actor, {
        entity: 'shift', entityId: id, action: 'UPDATE',
        before: toShiftView(current) as unknown as Record<string, unknown>,
        after: { ...input },
      });
      return toShiftView(updated!);
    });
  }

  /** The shift for anyone on a date no roster entry covers. One per company, by a unique index. */
  async makeDefault(actor: Actor, id: string): Promise<ShiftView> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [target] = await tx.select().from(shift).where(eq(shift.id, id)).for('update');
      if (!target) throw new NotFoundException('Shift not found');
      if (!target.isActive) {
        throw new ConflictException({ code: 'SHIFT_INACTIVE', message: `${target.name} is switched off. Switch it on first.` });
      }
      if (target.isDefault) return toShiftView(target);

      // Off first, then on: the unique index would refuse two defaults even for
      // the instant between the two statements.
      const [previous] = await tx.update(shift).set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(shift.isDefault, true), ne(shift.id, id)))
        .returning({ id: shift.id, code: shift.code });
      const [updated] = await tx.update(shift).set({ isDefault: true, updatedAt: new Date() })
        .where(eq(shift.id, id)).returning();

      await this.audit.record(tx, actor, {
        entity: 'shift', entityId: id, action: 'MAKE_DEFAULT',
        before: { defaultShift: previous?.code ?? null }, after: { defaultShift: target.code },
      });
      return toShiftView(updated!);
    });
  }
}
