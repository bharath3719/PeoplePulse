import {
  pgTable, uuid, text, bigint, boolean, date, timestamp, jsonb, pgEnum, index, unique,
} from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { location, department, designation, grade } from './org';

export const employeeStatus = pgEnum('employee_status', [
  'ONBOARDING', 'ACTIVE', 'NOTICE', 'EXITED',
]);

export const employmentType = pgEnum('employment_type', [
  'FULL_TIME', 'PART_TIME', 'INTERN', 'CONTRACT',
]);

export const gender = pgEnum('gender', ['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']);

/**
 * PF membership (ADR-004). THE most important enum in this schema.
 *
 *   NOT_APPLICABLE - the establishment is not EPF-registered. Nobody here has PF.
 *   EXCLUDED       - the establishment IS registered, but this person is out:
 *                    they joined on PF wages above Rs 15,000 and had never been
 *                    an EPF member before ("excluded employee", Para 2(f)).
 *   MEMBER         - contributing.
 *
 * NOT_APPLICABLE and EXCLUDED are different facts arising for different
 * reasons. Collapsing them into one flag destroys the ability to answer "why
 * did this employee get no PF?" — the first thing HR will ask.
 */
export const pfStatus = pgEnum('pf_status', ['NOT_APPLICABLE', 'EXCLUDED', 'MEMBER']);

export const esiStatus = pgEnum('esi_status', ['NOT_APPLICABLE', 'NOT_COVERED', 'COVERED']);

export const employee = pgTable('employee', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),

  empCode: text('emp_code').notNull(),

  // --- Personal ---------------------------------------------------------
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  dateOfBirth: date('date_of_birth'),
  gender: gender('gender'),
  personalEmail: text('personal_email'),
  workEmail: text('work_email'),
  phone: text('phone'),

  // --- Employment -------------------------------------------------------
  joinDate: date('join_date').notNull(),
  confirmationDate: date('confirmation_date'),
  exitDate: date('exit_date'),
  status: employeeStatus('status').notNull().default('ONBOARDING'),
  employmentType: employmentType('employment_type').notNull().default('FULL_TIME'),

  locationId: uuid('location_id').references(() => location.id),
  departmentId: uuid('department_id').references(() => department.id),
  designationId: uuid('designation_id').references(() => designation.id),
  gradeId: uuid('grade_id').references(() => grade.id),
  managerId: uuid('manager_id'),  // self-ref; FK added in migration to avoid a cycle

  // --- Statutory identifiers -------------------------------------------
  //
  // NOTE: there is no Aadhaar column, and that is deliberate (OPEN.md D-4).
  // The Aadhaar Act sharply restricts private entities storing Aadhaar numbers,
  // and encrypting an unlawful record does not make it lawful. Nothing breaks:
  // PF filings need the UAN, ESI needs the ESIC number. Neither needs Aadhaar.
  //
  // PAN and bank account ARE stored, encrypted at the column level (TR-52,
  // AES-256-GCM, per-tenant KMS keys). They are ciphertext at rest; the UI
  // shows masked values and decryption is gated on
  // `employee.identifiers.view` and audited.
  panEncrypted: text('pan_encrypted'),
  panLast4: text('pan_last4'),          // for masked display without decrypting

  uan: text('uan'),                     // Universal Account Number (PF)
  esicNumber: text('esic_number'),

  bankAccountEncrypted: text('bank_account_encrypted'),
  bankAccountLast4: text('bank_account_last4'),
  bankIfsc: text('bank_ifsc'),
  bankName: text('bank_name'),

  // --- PF / ESI eligibility (ADR-004) -----------------------------------
  //
  // THE TRAP THIS EXISTS TO PREVENT:
  //
  // PF membership is a fact about the employee's HISTORY, not their current
  // salary. Once a member, always a member — a raise past Rs 15,000 does NOT
  // eject an existing member, and does NOT pull in an excluded one.
  //
  // So `pfStatus` is set at hire and changed ONLY by explicit HR action. Any
  // code that recomputes it from this month's wage will silently enrol and
  // un-enrol people as they get raises, and will look completely correct in a
  // spot check. Golden tests in packages/payroll lock this down.
  pfStatus: pfStatus('pf_status').notNull().default('NOT_APPLICABLE'),

  /** PF wage at joining, in PAISE. Justifies an EXCLUDED status; evidence, not input. */
  pfJoiningWagePaise: bigint('pf_joining_wage_paise', { mode: 'number' }),

  /**
   * Did they have a PF account before joining us?
   *
   * If yes, they are a MEMBER regardless of salary — prior membership binds.
   * An existing UAN is strong evidence of this, which is why onboarding must
   * ASK for it (CHR-04). HR will not volunteer it.
   */
  hasPriorPfMembership: boolean('has_prior_pf_membership').notNull().default(false),

  /** Per-employee override of the tenant's PF ceiling election (D-10). Null = inherit. */
  pfRestrictToCeiling: boolean('pf_restrict_to_ceiling'),

  /**
   * ESI coverage is fixed at the START of a contribution period (Apr-Sep,
   * Oct-Mar) and holds until that period ENDS, even if the wage crosses
   * Rs 21,000 mid-period. Like PF, it cannot be recomputed from the current
   * month's wage.
   */
  esiStatus: esiStatus('esi_status').notNull().default('NOT_APPLICABLE'),

  // --- Soft delete (OPEN.md D-19) ---------------------------------------
  //
  // Two-tier deletion:
  //   - no payroll history  -> hard DELETE. Fixes typos, bad imports, test data.
  //   - has payroll history -> anonymise. They vanish from the UI, but the
  //     payslips, PF and TDS records survive, because NFR-08 requires statutory
  //     records for >= 8 YEARS. DPDP's erasure right is overridden by statutory
  //     retention, and this is how that override is implemented.
  //
  // "No payroll history" means NEVER APPEARED IN A FINALISED RUN — check the
  // run items, not the payslip table.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),

  customFields: jsonb('custom_fields').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  unique('employee_tenant_code_uq').on(t.tenantId, t.empCode),
  index('employee_tenant_idx').on(t.tenantId),
  index('employee_tenant_status_idx').on(t.tenantId, t.status),
  index('employee_manager_idx').on(t.managerId),
]);

/**
 * Immutable lifecycle history (CHR-07). Append-only: confirmation, transfer,
 * promotion, increment, exit — each with an effective date.
 *
 * Never updated, never deleted. A promotion that turns out to be wrong is
 * corrected by a new event, not by editing the old one — which is what makes
 * "what was this person's designation in March?" answerable.
 */
export const employeeEventType = pgEnum('employee_event_type', [
  'JOIN', 'CONFIRM', 'TRANSFER', 'PROMOTION', 'INCREMENT', 'EXIT', 'PF_STATUS_CHANGE',
]);

export const employeeEvent = pgTable('employee_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employee.id, { onDelete: 'cascade' }),

  type: employeeEventType('type').notNull(),
  effectiveDate: date('effective_date').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  reason: text('reason'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  index('employee_event_tenant_idx').on(t.tenantId),
  index('employee_event_employee_idx').on(t.employeeId, t.effectiveDate),
]);

export type Employee = typeof employee.$inferSelect;
export type NewEmployee = typeof employee.$inferInsert;
export type EmployeeEvent = typeof employeeEvent.$inferSelect;
