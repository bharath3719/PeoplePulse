import {
  Injectable, Inject, NotFoundException, ConflictException, BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and, isNull, ilike, or, desc, sql, type SQL } from 'drizzle-orm';
import {
  employee, employeeEvent, tenant, location, department, designation, grade, withTenant,
  type Database, type TenantDatabase, type Employee, type NewEmployee,
} from '@peoplepulse/db';
import {
  derivePfStatusAtHire, deriveEsiStatusAtPeriodStart, hasPriorPfMembership, fromRupees, paise,
  resolveScope, SCOPES, type Actor, type Scope,
} from '@peoplepulse/core';
import { DB } from '../../platform/database/database.module';
import { AuditService } from '../../platform/audit/audit.service';
import { PiiService } from '../../platform/crypto/pii.service';
import { unwritableFields } from '../../platform/rbac/redact';
import { validationFailed, type FieldError } from '../../platform/validation/zod.pipe';
import {
  WRITE_POLICY,
  type CreateEmployeeInput, type UpdateEmployeeInput, type UpdateEmployeeBankInput,
} from './employee.dto';

/**
 * Fields a correction copies straight onto the row. Everything else in
 * UpdateEmployeeInput needs handling: PAN is encrypted, and the PF facts and
 * join date are hire-time facts with consequences (see `update`).
 */
const PLAIN_FIELDS = [
  'firstName', 'lastName', 'dateOfBirth', 'gender', 'personalEmail', 'workEmail', 'phone',
  'employmentType', 'locationId', 'departmentId', 'designationId', 'gradeId', 'managerId',
  'uan', 'esicNumber',
] as const satisfies readonly (keyof UpdateEmployeeInput & keyof Employee)[];

/** Org units an employee points at. Checked in-tenant on every change; see `assertReferencesInTenant`. */
const ORG_REFERENCES = [
  { field: 'locationId', table: location },
  { field: 'departmentId', table: department },
  { field: 'designationId', table: designation },
  { field: 'gradeId', table: grade },
] as const;

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
      const hasPrior = hasPriorPfMembership(input.hasPriorPfMembership, input.uan);

      const pfStatus = derivePfStatusAtHire(establishment, {
        pfWageAtJoining,
        hasPriorPfMembership: hasPrior,
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
        hasPriorPfMembership: hasPrior,
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
   * Correct an employee's record (PATCH /employees/:id).
   *
   * This fixes what was entered wrong — a typo'd PAN, the wrong department
   * picked at creation. It is NOT how someone is transferred or promoted: those
   * are effective-dated lifecycle events (CHR-07), still to be built. A
   * correction overwrites the current value and leaves its trail in the audit
   * log; it does not claim the old value stopped being true on some date.
   *
   * Hire-time facts are the exception, because ADR-004 hangs PF status on them:
   *
   *   - Join date, PF wage at joining, and prior PF membership (including a UAN,
   *     which implies it) may be corrected only until the employee first appears
   *     in a FINALISED payroll run. After that, PF has been deducted — or not —
   *     on the strength of them, and changing them is an explicit PF-status
   *     action with arrears, not an edit.
   *
   *   - When one of them changes, pfStatus is re-derived by the SAME hire-time
   *     function create uses, and the change goes into the immutable history.
   *     When none of them changes, pfStatus is not touched, even if deriving it
   *     today would give a different answer. That is ADR-004's "never
   *     recompute" rule, and an edit to someone's phone number must not become
   *     the back door around it.
   */
  async update(actor: Actor, id: string, input: UpdateEmployeeInput): Promise<Employee> {
    // Reject, never strip — see unwritableFields. Vague, like the guard's 403.
    if (unwritableFields(actor, input, WRITE_POLICY).length > 0) throw new ForbiddenException();

    return withTenant(this.db, actor.tenantId, async (tx) => {
      const current = await this.findForEdit(tx, actor, id);

      const set: Partial<NewEmployee> = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};

      for (const field of PLAIN_FIELDS) {
        const next = input[field];
        if (next === undefined || next === current[field]) continue;
        Object.assign(set, { [field]: next });
        before[field] = current[field];
        after[field] = next;
      }

      // Ciphertext differs on every encryption, and telling whether the PAN
      // really changed would mean decrypting the old one — an audited read
      // (TR-52) of a value nobody asked to see. A PAN that was sent counts as
      // changed. Both sides are redacted by the audit log.
      if (input.pan !== undefined) {
        set.panEncrypted = input.pan === null ? null : this.pii.encrypt(input.pan);
        set.panLast4 = input.pan === null ? null : PiiService.last4(input.pan);
        before['pan'] = current.panEncrypted;
        after['pan'] = input.pan;
      }

      await this.assertReferencesInTenant(tx, current, input);

      // --- Hire-time facts (ADR-004) ------------------------------------
      const joinDate = input.joinDate ?? current.joinDate;
      const hasPrior = hasPriorPfMembership(
        input.hasPriorPfMembership ?? current.hasPriorPfMembership,
        input.uan === undefined ? current.uan : input.uan,
      );
      const pfJoiningWagePaise = input.pfWageAtJoiningRupees === undefined
        ? current.pfJoiningWagePaise
        : input.pfWageAtJoiningRupees === null ? null : fromRupees(input.pfWageAtJoiningRupees);

      const joinDateChanged = joinDate !== current.joinDate;
      const pfFactsChanged = hasPrior !== current.hasPriorPfMembership
        || pfJoiningWagePaise !== current.pfJoiningWagePaise;

      const events: (typeof employeeEvent.$inferInsert)[] = [];

      if (joinDateChanged || pfFactsChanged) {
        if (await this.hasFinalisedPayroll(id)) {
          const locked = (['joinDate', 'pfWageAtJoiningRupees', 'hasPriorPfMembership', 'uan'] as const)
            .filter((field) => input[field] !== undefined);
          throw new ConflictException({
            type: 'https://peoplepulse.in/errors/locked-after-payroll',
            title: 'Hire-time facts are locked once the employee has been paid',
            errors: locked.map((field) => ({
              field, message: 'Locked after the first finalised payroll run',
            })),
          });
        }
      }

      if (joinDateChanged) {
        set.joinDate = joinDate;
        before['joinDate'] = current.joinDate;
        after['joinDate'] = joinDate;

        // employee_event is immutable (CHR-07): a wrong JOIN is corrected by a
        // new JOIN, never by rewriting the old one. The latest JOIN is the truth.
        events.push({
          tenantId: actor.tenantId,
          employeeId: id,
          type: 'JOIN',
          effectiveDate: joinDate,
          payload: { correction: true, previousJoinDate: current.joinDate },
          reason: 'Correction of join date',
          createdBy: actor.userId,
        });
      }

      if (pfFactsChanged) {
        if (hasPrior !== current.hasPriorPfMembership) {
          set.hasPriorPfMembership = hasPrior;
          before['hasPriorPfMembership'] = current.hasPriorPfMembership;
          after['hasPriorPfMembership'] = hasPrior;
        }
        if (pfJoiningWagePaise !== current.pfJoiningWagePaise) {
          set.pfJoiningWagePaise = pfJoiningWagePaise;
          before['pfJoiningWagePaise'] = current.pfJoiningWagePaise; // redacted: it is a wage
          after['pfJoiningWagePaise'] = pfJoiningWagePaise;
        }

        const [company] = await tx.select({
          epfRegistered: tenant.epfRegistered,
          esiRegistered: tenant.esiRegistered,
        }).from(tenant).where(eq(tenant.id, actor.tenantId));
        if (!company) throw new NotFoundException('Company not found');

        // When the explicit opt-in action (ADR-004 case 3) exists, a correction
        // must not silently undo an opt-in. Today nothing can opt anyone in.
        const pfStatus = derivePfStatusAtHire(company, {
          pfWageAtJoining: paise(pfJoiningWagePaise ?? 0),
          hasPriorPfMembership: hasPrior,
        });

        if (pfStatus !== current.pfStatus) {
          set.pfStatus = pfStatus;
          before['pfStatus'] = current.pfStatus;
          after['pfStatus'] = pfStatus;

          events.push({
            tenantId: actor.tenantId,
            employeeId: id,
            type: 'PF_STATUS_CHANGE',
            // The corrected status is what it should have been from joining.
            effectiveDate: joinDate,
            payload: { from: current.pfStatus, to: pfStatus, correction: true },
            reason: 'Correction of hire-time PF facts',
            createdBy: actor.userId,
          });
        }
      }

      if (Object.keys(set).length === 0) return current; // nothing changed, nothing to audit

      const [updated] = await tx.update(employee)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(employee.id, id))
        .returning();

      if (events.length > 0) await tx.insert(employeeEvent).values(events);

      await this.audit.record(tx, actor, {
        entity: 'employee', entityId: id, action: 'UPDATE', before, after,
      });

      return updated!;
    });
  }

  /**
   * Change where an employee's salary is paid (PATCH /employees/:id/bank).
   *
   * A separate endpoint, not three more fields on PATCH /employees/:id, because
   * the permission IS the control: `employee.bank.edit` requires MFA (NFR-04),
   * and PermissionGuard enforces MFA per route. Folded into the general edit, a
   * bank change would ride in under `employee.edit` with no second factor — and
   * redirecting someone's salary is the payroll fraud.
   */
  async updateBank(actor: Actor, id: string, input: UpdateEmployeeBankInput): Promise<Employee> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const current = await this.findForEdit(tx, actor, id);

      const [updated] = await tx.update(employee).set({
        bankAccountEncrypted: this.pii.encrypt(input.bankAccount),
        bankAccountLast4: PiiService.last4(input.bankAccount),
        bankIfsc: input.bankIfsc,
        ...(input.bankName !== undefined && { bankName: input.bankName }),
        updatedAt: new Date(),
      }).where(eq(employee.id, id)).returning();

      // The account number is redacted by the audit log. The IFSC is not a
      // secret, and "which bank did the salary start going to?" is the first
      // question of a fraud investigation.
      await this.audit.record(tx, actor, {
        entity: 'employee', entityId: id, action: 'UPDATE_BANK',
        before: {
          bankAccount: current.bankAccountEncrypted,
          bankIfsc: current.bankIfsc,
          bankName: current.bankName,
        },
        after: {
          bankAccount: input.bankAccount,
          bankIfsc: input.bankIfsc,
          bankName: input.bankName === undefined ? current.bankName : input.bankName,
        },
      });

      return updated!;
    });
  }

  /**
   * The row an edit applies to, locked until the transaction ends.
   *
   * Scoped like a read: you cannot correct someone you cannot see. FOR UPDATE
   * because a correction reads the hire facts and re-derives PF from them, and
   * two concurrent corrections must not each derive from the other's stale facts.
   */
  private async findForEdit(tx: TenantDatabase, actor: Actor, id: string): Promise<Employee> {
    const scope = resolveScope(actor, SCOPES.employee);
    if (scope.kind === 'none') throw new NotFoundException('Employee not found');

    const conditions: SQL[] = [eq(employee.id, id), isNull(employee.deletedAt)];
    const scoped = scopeToCondition(scope);
    if (scoped) conditions.push(scoped);

    const [row] = await tx.select().from(employee).where(and(...conditions)).for('update');
    if (!row) throw new NotFoundException('Employee not found');
    return row;
  }

  /**
   * Every id an employee points at must belong to the SAME company.
   *
   * RLS does not give us this. Postgres runs foreign-key checks without
   * row-level security, so `department_id` accepts another tenant's department
   * without complaint — and `manager_id` has no foreign key at all. A select
   * under the tenant context is what actually asks "is this ours?".
   *
   * Only CHANGED references are checked: fixing someone's phone number is not
   * the moment to fail on a department that was set long ago.
   */
  private async assertReferencesInTenant(
    tx: TenantDatabase, current: Employee, input: UpdateEmployeeInput,
  ): Promise<void> {
    const errors: FieldError[] = [];

    for (const { field, table } of ORG_REFERENCES) {
      const refId = input[field];
      if (!refId || refId === current[field]) continue;

      const [found] = await tx.select({ id: table.id }).from(table).where(eq(table.id, refId));
      if (!found) errors.push({ field, message: 'Not found in this company' });
    }

    const managerId = input.managerId;
    if (managerId && managerId !== current.managerId) {
      if (managerId === current.id) {
        errors.push({ field: 'managerId', message: 'An employee cannot report to themselves' });
      } else {
        const [manager] = await tx.select({ id: employee.id }).from(employee)
          .where(and(eq(employee.id, managerId), isNull(employee.deletedAt)));

        if (!manager) {
          errors.push({ field: 'managerId', message: 'Not found in this company' });
        } else if (await this.reportsTo(tx, managerId, current.id)) {
          errors.push({
            field: 'managerId',
            message: 'This would create a reporting loop — that person already reports to this employee',
          });
        }
      }
    }

    if (errors.length > 0) throw validationFailed(errors);
  }

  /** Does `employeeId` report to `managerId`, directly or anywhere up the chain? */
  private async reportsTo(tx: TenantDatabase, employeeId: string, managerId: string): Promise<boolean> {
    // UNION, not UNION ALL: if the data already holds a loop (the importer only
    // refuses self-reports), the walk stops instead of running forever.
    const result = await tx.execute(sql`
      with recursive chain(id, manager_id) as (
        select id, manager_id from employee where id = ${employeeId}
        union
        select e.id, e.manager_id from employee e join chain c on e.id = c.manager_id
      )
      select 1 from chain where id = ${managerId} limit 1
    `);
    return result.rows.length > 0;
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
