import {
  Injectable, Inject, NotFoundException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { eq, and, isNull, ilike, or, desc, type SQL } from 'drizzle-orm';
import {
  employee, employeeEvent, tenant, withTenant, type Database, type Employee,
} from '@peoplepulse/db';
import {
  derivePfStatusAtHire, deriveEsiStatusAtPeriodStart, fromRupees,
  resolveScope, SCOPES, type Actor, type Scope,
} from '@peoplepulse/core';
import { DB } from '../../platform/database/database.module';
import { AuditService } from '../../platform/audit/audit.service';
import { PiiService } from '../../platform/crypto/pii.service';
import type { CreateEmployeeInput } from './employee.dto';

@Injectable()
export class EmployeeService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly pii: PiiService,
  ) {}

  /**
   * List employees, scoped by what the caller may see.
   *
   * The scope — all / my team / just me — is resolved ONCE from permissions and
   * handed to the query as a value. The service never branches:
   *
   *   if (can(actor,'x.view.all')) {...} else if (can(actor,'x.view.team')) {...}
   *
   * which is the if-sprawl we are avoiding. See ENGINEERING-STANDARDS.md §1.
   */
  async list(actor: Actor, search?: string): Promise<Employee[]> {
    const scope = resolveScope(actor, SCOPES.employee);
    if (scope.kind === 'none') return [];

    return withTenant(this.db, actor.tenantId, (tx) => {
      const conditions: SQL[] = [
        // Soft-deleted employees vanish from every list. Their payroll records
        // survive (NFR-08, 8-year retention) — see OPEN.md D-19.
        isNull(employee.deletedAt),
      ];

      const scoped = scopeToCondition(scope);
      if (scoped) conditions.push(scoped);

      if (search?.trim()) {
        const term = `%${search.trim()}%`;
        conditions.push(
          or(
            ilike(employee.firstName, term),
            ilike(employee.lastName, term),
            ilike(employee.empCode, term),
          )!,
        );
      }

      return tx.select().from(employee)
        .where(and(...conditions))
        .orderBy(desc(employee.createdAt))
        .limit(200);
    });
  }

  async findOne(actor: Actor, id: string): Promise<Employee> {
    const found = await withTenant(this.db, actor.tenantId, async (tx) => {
      const [row] = await tx.select().from(employee)
        .where(and(eq(employee.id, id), isNull(employee.deletedAt)));
      return row;
    });

    // RLS already guarantees we cannot see another tenant's row — it simply is
    // not there. So a miss is a 404, and it says nothing about whether the id
    // exists elsewhere.
    if (!found) throw new NotFoundException('Employee not found');
    return found;
  }

  async create(actor: Actor, input: CreateEmployeeInput): Promise<Employee> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [existing] = await tx.select({ id: employee.id }).from(employee)
        .where(eq(employee.empCode, input.empCode));
      if (existing) throw new ConflictException(`Employee code "${input.empCode}" is already in use`);

      const [company] = await tx.select().from(tenant).where(eq(tenant.id, actor.tenantId));
      if (!company) throw new NotFoundException('Company not found');

      /**
       * PF and ESI eligibility, decided HERE, at hire, ONCE (ADR-004).
       *
       * Two independent gates: is the COMPANY registered, and is this EMPLOYEE
       * a member. Both can be closed, and they mean different things —
       * NOT_APPLICABLE (no company scheme) is a different fact from EXCLUDED
       * (company has a scheme, this person is out of it).
       *
       * This is stored, not recomputed. A payroll run that re-derived it from
       * that month's wage would silently enrol and un-enrol people as they got
       * raises — and would look completely correct in a spot check.
       */
      const establishment = {
        epfRegistered: company.epfRegistered,
        esiRegistered: company.esiRegistered,
      };

      const pfWageAtJoining = fromRupees(input.pfWageAtJoiningRupees ?? 0);

      const pfStatus = derivePfStatusAtHire(establishment, {
        pfWageAtJoining,
        hasPriorPfMembership: input.hasPriorPfMembership || Boolean(input.uan),
        //                                                 ^^^^^^^^^^^^^^^^^^^
        // An existing UAN is strong evidence of prior membership. If HR supplies
        // one, the employee is a member regardless of what the checkbox said —
        // "once a member, always a member" is not something HR can toggle off by
        // forgetting to tick a box.
      });

      const esiStatus = deriveEsiStatusAtPeriodStart(
        establishment,
        fromRupees(input.grossMonthlyRupees ?? 0),
      );

      const [created] = await tx.insert(employee).values({
        tenantId: actor.tenantId,
        empCode: input.empCode,
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        dateOfBirth: input.dateOfBirth ?? null,
        gender: input.gender ?? null,
        personalEmail: input.personalEmail ?? null,
        workEmail: input.workEmail ?? null,
        phone: input.phone ?? null,
        joinDate: input.joinDate,
        status: 'ONBOARDING',
        employmentType: input.employmentType,
        locationId: input.locationId ?? null,
        departmentId: input.departmentId ?? null,
        designationId: input.designationId ?? null,
        gradeId: input.gradeId ?? null,
        managerId: input.managerId ?? null,

        // PAN and bank account are ciphertext at rest (TR-52). The last 4 are
        // stored in the clear so a list view can mask without decrypting.
        panEncrypted: input.pan ? this.pii.encrypt(input.pan) : null,
        panLast4: input.pan ? PiiService.last4(input.pan) : null,
        uan: input.uan ?? null,
        esicNumber: input.esicNumber ?? null,
        bankAccountEncrypted: input.bankAccount ? this.pii.encrypt(input.bankAccount) : null,
        bankAccountLast4: input.bankAccount ? PiiService.last4(input.bankAccount) : null,
        bankIfsc: input.bankIfsc ?? null,
        bankName: input.bankName ?? null,

        pfStatus,
        pfJoiningWagePaise: input.pfWageAtJoiningRupees === undefined ? null : pfWageAtJoining,
        hasPriorPfMembership: input.hasPriorPfMembership || Boolean(input.uan),
        esiStatus,

        createdBy: actor.userId,
      }).returning();

      const row = created!;

      // Immutable history (CHR-07). Append-only at the database level.
      await tx.insert(employeeEvent).values({
        tenantId: actor.tenantId,
        employeeId: row.id,
        type: 'JOIN',
        effectiveDate: input.joinDate,
        payload: { pfStatus, esiStatus },
        createdBy: actor.userId,
      });

      await this.audit.record(tx, actor, {
        entity: 'employee',
        entityId: row.id,
        action: 'CREATE',
        after: { empCode: row.empCode, name: row.firstName, pfStatus, esiStatus },
      });

      return row;
    });
  }

  /**
   * Two-tier deletion (OPEN.md D-19).
   *
   *   no payroll history  -> hard DELETE. Fixes typos, bad imports, test data.
   *   has payroll history -> ANONYMISE. They vanish from every UI, but the
   *                          payslips, PF and TDS records survive — NFR-08
   *                          requires statutory records for >= 8 YEARS, and that
   *                          retention OVERRIDES DPDP's erasure right.
   *
   * "No payroll history" will mean "never appeared in a FINALISED run" once
   * payroll exists (Phase 2). Until then nothing has payroll history, so this
   * hard-deletes — which is correct for now and must be revisited the day
   * payroll_run_item lands. The guard below is the reminder.
   */
  async remove(actor: Actor, id: string): Promise<{ deleted: 'HARD' | 'ANONYMISED' }> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [found] = await tx.select().from(employee).where(eq(employee.id, id));
      if (!found) throw new NotFoundException('Employee not found');

      const hasPayrollHistory = await this.hasFinalisedPayroll(id);

      if (hasPayrollHistory) {
        await tx.update(employee).set({
          deletedAt: new Date(),
          anonymisedAt: new Date(),
          firstName: 'Deleted',
          lastName: 'Employee',
          personalEmail: null,
          workEmail: null,
          phone: null,
          panEncrypted: null,
          panLast4: null,
          bankAccountEncrypted: null,
          bankAccountLast4: null,
          bankIfsc: null,
        }).where(eq(employee.id, id));

        await this.audit.record(tx, actor, {
          entity: 'employee', entityId: id, action: 'ANONYMISE',
          before: { empCode: found.empCode },
          after: { reason: 'has payroll history; statutory retention (NFR-08) overrides erasure' },
        });

        return { deleted: 'ANONYMISED' as const };
      }

      await this.audit.record(tx, actor, {
        entity: 'employee', entityId: id, action: 'DELETE',
        before: { empCode: found.empCode, name: found.firstName },
      });
      await tx.delete(employee).where(eq(employee.id, id));

      return { deleted: 'HARD' as const };
    });
  }

  /**
   * Placeholder until Phase 2. When payroll_run_item exists this must check for
   * membership of a FINALISED run — not the payslip table, and not "has a salary
   * structure". Deleting someone who has been paid destroys statutory records.
   */
  private async hasFinalisedPayroll(_employeeId: string): Promise<boolean> {
    return false;
  }

  /**
   * Decrypt PAN or bank details. Gated, and AUDITED (TR-52).
   *
   * Reading someone's bank account is worth knowing about even when it is
   * authorized. This is the grep-able answer to "who looked at that, and when?".
   */
  async revealIdentifiers(
    actor: Actor, id: string,
  ): Promise<{ pan: string | null; bankAccount: string | null }> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [found] = await tx.select().from(employee).where(eq(employee.id, id));
      if (!found) throw new NotFoundException('Employee not found');

      await this.audit.recordPiiAccess(tx, actor, id, ['pan', 'bankAccount']);

      return {
        pan: found.panEncrypted ? this.pii.decrypt(found.panEncrypted) : null,
        bankAccount: found.bankAccountEncrypted
          ? this.pii.decrypt(found.bankAccountEncrypted)
          : null,
      };
    });
  }
}

/** Turns a resolved scope into a WHERE clause. The only place scope meets SQL. */
function scopeToCondition(scope: Scope): SQL | undefined {
  switch (scope.kind) {
    case 'all':
      return undefined;
    case 'team':
      return eq(employee.managerId, scope.managerEmployeeId);
    case 'own':
      return eq(employee.id, scope.employeeId);
    case 'none':
      throw new BadRequestException('no scope'); // unreachable; callers check first
  }
}
