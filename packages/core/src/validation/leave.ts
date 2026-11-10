import { z } from 'zod';
import { istDate, leaveYearOf } from '../date/india';
import { ACCRUAL_FREQUENCIES } from '../leave/accrual';
import { DAY_COUNT_BASES, SESSIONS } from '../leave/span';

/**
 * Leave validation, stated once for the web form and the API (see employee.ts
 * for why it lives here).
 *
 * Quantities cross this boundary in DAYS, with the unit in the field name, the
 * way money crosses it in rupees. The API turns them into hundredths of a day
 * (leave/units.ts) on the way in and never does arithmetic on them as days.
 */

/** Days as HR types them: 6.25 yes, 6.255 no. */
const days = z.number().finite()
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, 'Use at most two decimal places');

const spanFields = {
  leaveTypeId: z.string().uuid('Pick a leave type'),
  startDate: z.string().date('Pick a start date'),
  startSession: z.enum(SESSIONS).default('FIRST'),
  endDate: z.string().date('Pick an end date'),
  endSession: z.enum(SESSIONS).default('SECOND'),
};

type SpanShape = { startDate: string; startSession: string; endDate: string; endSession: string };

/**
 * The span rules a form can check before the server is asked. The server checks
 * them again (leave/span.ts assertValidSpan) — along with the ones only it can,
 * like the employee's join date and what they have already applied for.
 */
function refineSpan(span: SpanShape, ctx: z.RefinementCtx): void {
  // zod runs this even when a date above already failed; that failure is the
  // message the person needs, and istDate() would throw on the bad value.
  if (!isRealDate(span.startDate) || !isRealDate(span.endDate)) return;

  if (span.endDate < span.startDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'Ends before it starts' });
    return;
  }
  if (span.startDate === span.endDate && span.startSession === 'SECOND' && span.endSession === 'FIRST') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ['endSession'],
      message: 'A day cannot start in the afternoon and end in the morning',
    });
  }
  if (leaveYearOf(istDate(span.startDate)) !== leaveYearOf(istDate(span.endDate))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ['endDate'],
      message: 'Leave cannot run across the new year — apply for each year separately',
    });
  }
}

function isRealDate(value: string): boolean {
  try {
    istDate(value);
    return true;
  } catch {
    return false;
  }
}

/** "How many days is this, and what will I have left?" — asked while the form is filled in. */
export const previewLeaveSchema = z.object(spanFields).strict().superRefine(refineSpan);
export type PreviewLeaveInput = z.infer<typeof previewLeaveSchema>;

/** Apply for leave (LVE-05). Always for yourself: the API takes the employee from the login. */
export const applyLeaveSchema = z.object({
  ...spanFields,
  reason: z.string().trim().max(500).optional(),
}).strict().superRefine(refineSpan);
export type ApplyLeaveInput = z.infer<typeof applyLeaveSchema>;

/**
 * Approve or reject (LVE-03). A rejection must say why: the person on the other
 * end is deciding whether to come to work.
 */
export const leaveDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVE'), note: z.string().trim().max(500).optional() }).strict(),
  z.object({
    decision: z.literal('REJECT'),
    note: z.string().trim().min(1, 'Say why, so they can plan around it').max(500),
  }).strict(),
]);
export type LeaveDecisionInput = z.infer<typeof leaveDecisionSchema>;

const leaveTypeFields = {
  name: z.string().trim().min(1, 'Name it').max(60),
  allowsHalfDay: z.boolean(),
  accrualFrequency: z.enum(ACCRUAL_FREQUENCIES),
  annualEntitlementDays: days.pipe(z.number().min(0).max(366)),
  proRataOnJoin: z.boolean(),
  dayCountBasis: z.enum(DAY_COUNT_BASES),
  /** Year end (D-25): the most that carries into the next year. 0 lapses it all; null has no limit. */
  carryForwardMaxDays: days.pipe(z.number().min(0).max(366)).nullable(),
  /** Year end: of what does not carry, the most set aside for payroll to pay out. The rest lapses. */
  encashMaxDays: days.pipe(z.number().min(0).max(366)),
};

/**
 * A leave type (LVE-01).
 *
 * The code is what payroll and reports will match on, so it is short, upper
 * case, and — once created — never edited.
 */
export const createLeaveTypeSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{0,9}$/, 'Letters and digits, up to 10, e.g. CL'),
  isPaid: z.boolean().default(true),
  ...leaveTypeFields,
  allowsHalfDay: leaveTypeFields.allowsHalfDay.default(true),
  accrualFrequency: leaveTypeFields.accrualFrequency.default('NONE'),
  annualEntitlementDays: leaveTypeFields.annualEntitlementDays.default(0),
  proRataOnJoin: leaveTypeFields.proRataOnJoin.default(true),
  dayCountBasis: leaveTypeFields.dayCountBasis.default('WORKING_DAYS'),
  // The column's default: a type nobody has written a year-end rule for keeps
  // its days rather than losing them.
  carryForwardMaxDays: leaveTypeFields.carryForwardMaxDays.default(null),
  encashMaxDays: leaveTypeFields.encashMaxDays.default(0),
}).strict().superRefine((type, ctx) => {
  if (!type.isPaid && type.accrualFrequency !== 'NONE') {
    // Unpaid leave has no balance — there is nothing to run out of — so there
    // is nothing to earn either.
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['accrualFrequency'], message: 'Unpaid leave does not accrue' });
  }
  if (!type.isPaid && type.encashMaxDays > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['encashMaxDays'], message: 'Unpaid leave has no balance to encash' });
  }
  if (type.accrualFrequency !== 'NONE' && type.annualEntitlementDays === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['annualEntitlementDays'], message: 'How many days a year?' });
  }
});
export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;

/**
 * Change a leave type. Neither the code nor whether it is paid: payroll matches
 * on the first, and the second decides whether a balance exists at all — turning
 * it off would strand every balance already earned.
 *
 * A change applies from now on. Credits already posted stay as they were.
 */
export const updateLeaveTypeSchema = z.object({
  ...leaveTypeFields,
  isActive: z.boolean(),
}).partial().strict();
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;

/** A holiday (LVE-04). No location means every location. */
export const createHolidaySchema = z.object({
  date: z.string().date('Pick a date'),
  name: z.string().trim().min(1, 'Name it').max(80),
  locationId: z.string().uuid().nullable().default(null),
}).strict();
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

/**
 * The company's weekly offs, 0 = Sunday .. 6 = Saturday. At least one working
 * day, or every leave request counts as nothing. Rosters (ATT-04) will set this
 * per employee; until then it is one setting for the company.
 */
export const leaveSettingsSchema = z.object({
  weeklyOffDays: z.array(z.number().int().min(0).max(6)).max(6, 'Leave at least one working day')
    .transform((list) => [...new Set(list)].sort((a, b) => a - b)),
}).strict();
export type LeaveSettingsInput = z.infer<typeof leaveSettingsSchema>;

/**
 * A manual change to someone's balance, written to the ledger with its reason.
 *
 * OPENING is the balance carried in from before PeoplePulse (LVE-08); ADJUSTMENT
 * is anything else HR corrects. Balances are never edited — they are the sum of
 * the ledger — so this is the only way to change one by hand (TR-15).
 */
export const LEAVE_ADJUSTMENT_KINDS = ['OPENING', 'ADJUSTMENT'] as const;

export const leaveAdjustmentSchema = z.object({
  employeeId: z.string().uuid(),
  leaveTypeId: z.string().uuid('Pick a leave type'),
  calendarYear: z.number().int().min(2000).max(2100),
  kind: z.enum(LEAVE_ADJUSTMENT_KINDS),
  days: days.pipe(z.number().min(-366).max(366)).refine((value) => value !== 0, 'Enter a number of days'),
  reason: z.string().trim().min(3, 'Say why — it is kept with the balance').max(300),
}).strict();
export type LeaveAdjustmentInput = z.infer<typeof leaveAdjustmentSchema>;

/** Post accruals and yearly grants for the leave year, up to and including this month. */
export const postAccrualsSchema = z.object({
  through: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'A month, as YYYY-MM'),
}).strict();
export type PostAccrualsInput = z.infer<typeof postAccrualsSchema>;

/**
 * Close a leave year (LVE-02, D-25): carry forward, encash and lapse each
 * balance by its type's rules. The same body previews it.
 */
export const leaveYearEndSchema = z.object({
  year: z.number().int().min(2000).max(2100),
}).strict();
export type LeaveYearEndInput = z.infer<typeof leaveYearEndSchema>;
