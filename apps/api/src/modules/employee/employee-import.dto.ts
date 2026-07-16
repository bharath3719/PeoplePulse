import { z } from 'zod';

/**
 * One row of the import template.
 *
 * Every message here is written to be read by an HR admin looking at a
 * validation report, not by a developer looking at a stack trace. "Invalid
 * input" tells Priya nothing; "PAN must look like ABCDE1234F" tells her exactly
 * what to type.
 */

const optionalText = (max: number) =>
  z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : String(v).trim()),
    z.string().max(max).optional(),
  );

/** Excel gives us a number for "12000" and a string for "12,000". Accept both. */
const optionalRupees = z.preprocess((v) => {
  if (v === '' || v === undefined || v === null) return undefined;
  const n = Number(String(v).replace(/[,\s₹]/g, ''));
  return Number.isNaN(n) ? v : n;
}, z.number({ invalid_type_error: 'Must be a number, e.g. 12000' }).nonnegative().optional());

/**
 * YES / NO — and the messy things HR will actually type.
 *
 * Anything unrecognised is an ERROR, never a silent `false`. Defaulting a blank
 * to "no prior PF" would quietly EXCLUDE someone who should be a MEMBER, which
 * is precisely the silent wrong number ADR-004 exists to prevent. Make them say it.
 */
const yesNo = z.preprocess((v) => {
  if (v === '' || v === undefined || v === null) return undefined;
  const s = String(v).trim().toUpperCase();
  if (['YES', 'Y', 'TRUE', '1'].includes(s)) return true;
  if (['NO', 'N', 'FALSE', '0'].includes(s)) return false;
  return v; // falls through to the error below
}, z.boolean({ invalid_type_error: 'Enter YES or NO' }).optional().default(false));

const isoDate = (label: string) =>
  z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : String(v).trim()),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be YYYY-MM-DD, e.g. 2026-04-01`),
  );

export const importRowSchema = z.object({
  empCode: z.preprocess(
    (v) => (v === undefined || v === null ? '' : String(v).trim()),
    z.string().min(1, 'Employee code is required').max(32),
  ),
  firstName: z.preprocess(
    (v) => (v === undefined || v === null ? '' : String(v).trim()),
    z.string().min(1, 'First name is required').max(80),
  ),
  lastName: optionalText(80),

  joinDate: isoDate('Join date'),
  dateOfBirth: isoDate('Date of birth').optional(),

  gender: z.preprocess(
    (v) => (v ? String(v).trim().toUpperCase() : undefined),
    z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'], {
      errorMap: () => ({ message: 'Must be MALE, FEMALE, OTHER or UNDISCLOSED' }),
    }).optional(),
  ),

  workEmail: z.preprocess(
    (v) => (v ? String(v).trim() : undefined),
    z.string().email('Not a valid email address').optional(),
  ),
  phone: optionalText(20),

  employmentType: z.preprocess(
    (v) => (v ? String(v).trim().toUpperCase().replace(/[\s-]/g, '_') : 'FULL_TIME'),
    z.enum(['FULL_TIME', 'PART_TIME', 'INTERN', 'CONTRACT'], {
      errorMap: () => ({ message: 'Must be FULL_TIME, PART_TIME, INTERN or CONTRACT' }),
    }).default('FULL_TIME'),
  ),

  locationName: optionalText(80),
  departmentName: optionalText(80),
  designationName: optionalText(80),
  managerEmpCode: optionalText(32),

  // No Aadhaar column. Deliberate — we do not collect it (OPEN.md D-4).
  pan: z.preprocess(
    (v) => (v ? String(v).trim().toUpperCase() : undefined),
    z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN must look like ABCDE1234F').optional(),
  ),
  uan: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : String(v).trim()),
    z.string().regex(/^\d{12}$/, 'UAN must be exactly 12 digits').optional(),
  ),
  esicNumber: optionalText(20),

  bankAccount: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : String(v).trim()),
    z.string().min(6).max(20).optional(),
  ),
  bankIfsc: z.preprocess(
    (v) => (v ? String(v).trim().toUpperCase() : undefined),
    z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC must look like HDFC0001234').optional(),
  ),

  /**
   * The two PF columns (ADR-004).
   *
   * These are ASKED FOR, never inferred. An import that guessed `pfStatus` from
   * a salary column would reintroduce the whole bug at 200 rows a time — and it
   * would be invisible, because every row would look plausible.
   */
  pfWageAtJoiningRupees: optionalRupees,
  hasPriorPfMembership: yesNo,

  grossMonthlyRupees: optionalRupees,
});

export type ImportRow = z.infer<typeof importRowSchema>;
