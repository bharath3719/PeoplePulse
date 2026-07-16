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

export const updateEmployeeSchema = createEmployeeSchema.partial().omit({ empCode: true });

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
