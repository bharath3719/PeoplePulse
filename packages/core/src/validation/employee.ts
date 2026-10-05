import { z } from 'zod';

/**
 * Employee validation, stated ONCE.
 *
 * This lives in `core` rather than in the API because the web form and the API
 * endpoint have to agree about what a valid PAN is. When these rules lived in
 * `apps/api`, the web client could not reach them, so the form either re-derived
 * them (two regexes to keep in sync) or skipped validation and let the server
 * reject the submission after the user had filled in twelve fields.
 *
 * Both sides now import from here. A rule changes in one place.
 */

/** PAN: 5 letters, 4 digits, 1 letter. e.g. ABCDE1234F */
export const PAN = z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN must look like ABCDE1234F');

/**
 * UAN is 12 digits. Its PRESENCE is the strongest evidence of prior PF
 * membership (ADR-004), which is why onboarding asks for it explicitly.
 */
export const UAN = z.string().regex(/^\d{12}$/, 'UAN must be 12 digits');

export const IFSC = z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC must look like HDFC0001234');

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'INTERN', 'CONTRACT'] as const;
export const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'] as const;

export const createEmployeeSchema = z.object({
  empCode: z.string().min(1).max(32),
  firstName: z.string().min(1).max(80),
  lastName: z.string().max(80).optional(),
  dateOfBirth: z.string().date().optional(),
  gender: z.enum(GENDERS).optional(),
  personalEmail: z.string().email().optional(),
  workEmail: z.string().email().optional(),
  phone: z.string().max(20).optional(),

  joinDate: z.string().date(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),

  locationId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),

  // NOTE: no `aadhaar` field. Deliberate, and not an oversight — see ADR-004
  // and OPEN.md D-4. We do not collect it.
  pan: PAN.optional(),
  uan: UAN.optional(),
  esicNumber: z.string().max(20).optional(),

  bankAccount: z.string().min(6).max(20).optional(),
  bankIfsc: IFSC.optional(),
  bankName: z.string().max(80).optional(),

  /**
   * PF facts, gathered AT HIRE (ADR-004).
   *
   * `pfWageAtJoining` and `hasPriorPfMembership` are INPUTS to the eligibility
   * decision, not the decision itself. The API derives `pfStatus` from them and
   * from whether the company is EPF-registered — the client cannot set it
   * directly, because a client that could set it could get it wrong.
   */
  pfWageAtJoiningRupees: z.number().nonnegative().optional(),
  hasPriorPfMembership: z.boolean().default(false),

  grossMonthlyRupees: z.number().nonnegative().optional(), // drives ESI coverage
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

// The update schemas below reuse each field's rule from the create schema, so a
// PAN is validated by exactly one regex whichever endpoint it arrives through.
const fields = createEmployeeSchema.shape;

/** Optional on create; on update, `null` means "clear it" and absent means "leave it". */
function clearable<T extends z.ZodTypeAny>(field: z.ZodOptional<T>) {
  return field.unwrap().nullable();
}

/**
 * A CORRECTION to an employee's record — PATCH /employees/:id.
 *
 * An absent key leaves the field alone; `null` clears it. That distinction is
 * why this is not `createEmployeeSchema.partial()`: a partial create schema has
 * no way to say "remove their work email", and it still carries the create
 * DEFAULTS — so every edit would silently send `hasPriorPfMembership: false`,
 * and PF status would be re-derived from a fact nobody touched.
 *
 * Deliberately NOT editable here:
 *   - empCode: the key other records and re-imports match on (OPEN.md D-19).
 *   - bank details: their own endpoint, behind `employee.bank.edit`, which
 *     requires MFA. Redirecting someone's salary is the classic payroll fraud.
 *   - grossMonthlyRupees: never stored. ESI coverage is re-established at the
 *     start of each contribution period (ADR-004), not corrected after the fact.
 *   - status: confirmation and exit are lifecycle events (CHR-07), not edits.
 *
 * Strict, so a client that sends `bankAccount` here gets a 400 rather than a
 * 200 that quietly ignored the one field it cared about.
 */
export const updateEmployeeSchema = z.object({
  firstName: fields.firstName,
  lastName: clearable(fields.lastName),
  dateOfBirth: clearable(fields.dateOfBirth),
  gender: clearable(fields.gender),
  personalEmail: clearable(fields.personalEmail),
  workEmail: clearable(fields.workEmail),
  phone: clearable(fields.phone),

  joinDate: fields.joinDate,
  employmentType: fields.employmentType.removeDefault(),

  locationId: clearable(fields.locationId),
  departmentId: clearable(fields.departmentId),
  designationId: clearable(fields.designationId),
  gradeId: clearable(fields.gradeId),
  managerId: clearable(fields.managerId),

  pan: clearable(fields.pan),
  uan: clearable(fields.uan),
  esicNumber: clearable(fields.esicNumber),

  // Hire-time PF facts (ADR-004). Correctable only until the employee's first
  // finalised payroll run; the API re-derives pfStatus from them when they change.
  pfWageAtJoiningRupees: clearable(fields.pfWageAtJoiningRupees),
  hasPriorPfMembership: fields.hasPriorPfMembership.removeDefault(),
}).partial().strict();

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

/**
 * Where salary is paid — PATCH /employees/:id/bank.
 *
 * Account and IFSC travel together. Changing one without the other is how a
 * NEFT file ends up with an account number at the wrong bank.
 */
export const updateEmployeeBankSchema = z.object({
  bankAccount: fields.bankAccount.unwrap(),
  bankIfsc: fields.bankIfsc.unwrap(),
  bankName: clearable(fields.bankName).optional(),
}).strict();

export type UpdateEmployeeBankInput = z.infer<typeof updateEmployeeBankSchema>;
