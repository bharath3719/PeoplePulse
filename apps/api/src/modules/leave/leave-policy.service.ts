import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import {
  holiday, leaveType, location, tenant, withTenant,
  type Database, type NewLeaveType,
} from '@peoplepulse/db';
import { DEFAULT_LEAVE_TYPES, fromDays, type Actor } from '@peoplepulse/core';
import { DB } from '../../platform/database/database.module';
import { AuditService } from '../../platform/audit/audit.service';
import { validationFailed } from '../../platform/validation/zod.pipe';
import {
  toHolidayView, toLeaveTypeView,
  type CreateHolidayInput, type CreateLeaveTypeInput, type HolidayView, type LeaveSettingsInput,
  type LeaveTypeView, type UpdateLeaveTypeInput,
} from './leave.dto';

/**
 * The default leave types as rows for one company. Signup writes these
 * (TR-02); `addDefaultTypes` writes whichever a company is missing.
 */
export function defaultLeaveTypeRows(tenantId: string, createdBy: string | null = null): NewLeaveType[] {
  return DEFAULT_LEAVE_TYPES.map(({ annualEntitlement, ...template }) => ({
    ...template,
    tenantId,
    annualEntitlementHundredths: annualEntitlement,
    createdBy,
  }));
}

/**
 * Leave POLICY: the types a company offers, its holidays, and its weekly offs
 * (LVE-01, LVE-04). What the rules are, not who has taken what — that is
 * LeaveService and LeaveLedgerService.
 */
@Injectable()
export class LeavePolicyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async listTypes(actor: Actor): Promise<LeaveTypeView[]> {
    const rows = await withTenant(this.db, actor.tenantId, (tx) =>
      tx.select().from(leaveType).orderBy(desc(leaveType.isActive), asc(leaveType.code)));
    return rows.map(toLeaveTypeView);
  }

  async createType(actor: Actor, input: CreateLeaveTypeInput): Promise<LeaveTypeView> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [taken] = await tx.select({ id: leaveType.id }).from(leaveType).where(eq(leaveType.code, input.code));
      if (taken) throw validationFailed([{ field: 'code', message: `${input.code} is already a leave type here` }]);

      const { annualEntitlementDays, ...fields } = input;
      const [created] = await tx.insert(leaveType).values({
        ...fields,
        tenantId: actor.tenantId,
        annualEntitlementHundredths: fromDays(annualEntitlementDays),
        createdBy: actor.userId,
      }).returning();

      await this.audit.record(tx, actor, {
        entity: 'leave_type', entityId: created!.id, action: 'CREATE', after: { ...input },
      });
      return toLeaveTypeView(created!);
    });
  }

  /** Applies from now on: credits already posted, and requests already made, keep what they were. */
  async updateType(actor: Actor, id: string, input: UpdateLeaveTypeInput): Promise<LeaveTypeView> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [current] = await tx.select().from(leaveType).where(eq(leaveType.id, id)).for('update');
      if (!current) throw new NotFoundException('Leave type not found');

      const { annualEntitlementDays, ...fields } = input;
      const next = {
        ...fields,
        ...(annualEntitlementDays !== undefined && { annualEntitlementHundredths: fromDays(annualEntitlementDays) }),
      };

      // The same rules createLeaveTypeSchema checks, against the type as it
      // will be — a PATCH carries only what changed.
      const frequency = next.accrualFrequency ?? current.accrualFrequency;
      const entitlement = next.annualEntitlementHundredths ?? current.annualEntitlementHundredths;
      if (!current.isPaid && frequency !== 'NONE') {
        throw validationFailed([{ field: 'accrualFrequency', message: 'Unpaid leave does not accrue' }]);
      }
      if (frequency !== 'NONE' && entitlement === 0) {
        throw validationFailed([{ field: 'annualEntitlementDays', message: 'How many days a year?' }]);
      }

      const [updated] = await tx.update(leaveType)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(leaveType.id, id))
        .returning();

      await this.audit.record(tx, actor, {
        entity: 'leave_type', entityId: id, action: 'UPDATE',
        before: toLeaveTypeView(current) as unknown as Record<string, unknown>,
        after: { ...input },
      });
      return toLeaveTypeView(updated!);
    });
  }

  /**
   * Add whichever default types this company does not have, by code. For
   * companies that signed up before leave existed, and for one that deleted
   * its way into a corner. Never touches a type that is already there.
   */
  async addDefaultTypes(actor: Actor): Promise<LeaveTypeView[]> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const added = await tx.insert(leaveType)
        .values(defaultLeaveTypeRows(actor.tenantId, actor.userId))
        .onConflictDoNothing()
        .returning();

      if (added.length > 0) {
        await this.audit.record(tx, actor, {
          entity: 'leave_type', action: 'ADD_DEFAULTS', after: { codes: added.map((t) => t.code) },
        });
      }
      return added.map(toLeaveTypeView);
    });
  }

  async listHolidays(actor: Actor, year: number): Promise<HolidayView[]> {
    const rows = await withTenant(this.db, actor.tenantId, (tx) =>
      tx.select({ holiday, locationName: location.name })
        .from(holiday)
        .leftJoin(location, eq(location.id, holiday.locationId))
        .where(and(gte(holiday.date, `${year}-01-01`), lte(holiday.date, `${year}-12-31`)))
        .orderBy(asc(holiday.date), asc(location.name)));
    return rows.map((r) => toHolidayView(r.holiday, r.locationName));
  }

  async createHoliday(actor: Actor, input: CreateHolidayInput): Promise<HolidayView> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      // Asked under RLS, because the foreign key is not: Postgres checks it
      // without row-level security, so another company's location id would pass.
      let locationName: string | null = null;
      if (input.locationId) {
        const [found] = await tx.select({ name: location.name }).from(location)
          .where(eq(location.id, input.locationId));
        if (!found) throw validationFailed([{ field: 'locationId', message: 'Pick one of this company\'s locations' }]);
        locationName = found.name;
      }

      const [created] = await tx.insert(holiday).values({
        tenantId: actor.tenantId,
        locationId: input.locationId,
        date: input.date,
        name: input.name,
        createdBy: actor.userId,
      }).onConflictDoNothing().returning();

      if (!created) {
        throw new ConflictException({
          code: 'HOLIDAY_EXISTS',
          message: `There is already a holiday on ${input.date}${locationName ? ` at ${locationName}` : ' for every location'}`,
        });
      }

      await this.audit.record(tx, actor, {
        entity: 'holiday', entityId: created.id, action: 'CREATE', after: { ...input },
      });
      return toHolidayView(created, locationName);
    });
  }

  async deleteHoliday(actor: Actor, id: string): Promise<void> {
    await withTenant(this.db, actor.tenantId, async (tx) => {
      const [removed] = await tx.delete(holiday).where(eq(holiday.id, id)).returning();
      if (!removed) throw new NotFoundException('Holiday not found');
      await this.audit.record(tx, actor, {
        entity: 'holiday', entityId: id, action: 'DELETE', before: { date: removed.date, name: removed.name },
      });
    });
  }

  async settings(actor: Actor): Promise<{ weeklyOffDays: number[] }> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [company] = await tx.select({ weeklyOffDays: tenant.weeklyOffDays })
        .from(tenant).where(eq(tenant.id, actor.tenantId));
      return { weeklyOffDays: company?.weeklyOffDays ?? [0] };
    });
  }

  /** Like a holiday, a new weekly off does not re-price leave already requested (OPEN.md D-23). */
  async updateSettings(actor: Actor, input: LeaveSettingsInput): Promise<{ weeklyOffDays: number[] }> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [before] = await tx.select({ weeklyOffDays: tenant.weeklyOffDays })
        .from(tenant).where(eq(tenant.id, actor.tenantId));

      const [updated] = await tx.update(tenant)
        .set({ weeklyOffDays: input.weeklyOffDays, updatedAt: new Date() })
        .where(eq(tenant.id, actor.tenantId))
        .returning({ weeklyOffDays: tenant.weeklyOffDays });

      await this.audit.record(tx, actor, {
        entity: 'tenant', entityId: actor.tenantId, action: 'UPDATE_LEAVE_SETTINGS',
        before: { weeklyOffDays: before?.weeklyOffDays }, after: { ...input },
      });
      return { weeklyOffDays: updated!.weeklyOffDays };
    });
  }
}
