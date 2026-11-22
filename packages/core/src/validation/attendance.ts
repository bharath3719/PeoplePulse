import { z } from 'zod';
import { parseClock } from '../attendance/shift';
import { weeklyOffDaysSchema } from './leave';

/**
 * Attendance validation, stated once for the web forms and the API (see
 * employee.ts for why it lives here).
 *
 * Times cross this boundary as "HH:MM" in IST, the way leave crosses it in days:
 * the API turns them into minutes past midnight (attendance/shift.ts) on the
 * way in, and does its arithmetic only on those.
 */

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A time, as HH:MM on the 24-hour clock');

const shiftFields = {
  name: z.string().trim().min(1, 'Name it').max(60),
  startTime: clock,
  endTime: clock,
  /** How late an arrival may be and still count as on time. */
  graceMinutes: z.number().int().min(0, 'Zero or more minutes').max(120, 'At most two hours'),
};

function refineTimes(shift: { startTime?: string | undefined; endTime?: string | undefined }, ctx: z.RefinementCtx): void {
  if (!shift.startTime || !shift.endTime) return;
  try {
    // An end at the start would be a 24-hour shift, or a typo; either way it
    // leaves no gap between one day's shift and the next to decide whose a
    // punch is (attendanceDateOf).
    if (parseClock(shift.startTime) === parseClock(shift.endTime)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endTime'], message: 'Ends when it starts' });
    }
  } catch {
    // The regex above has already said what is wrong with the time.
  }
}

/**
 * A shift (ATT-04). An end at or before the start runs past midnight —
 * 22:00 to 06:00 is a night shift — and needs nothing else to say so.
 *
 * The code, like a leave type's, is what reports and rosters match on: short,
 * upper case, never edited once created.
 */
export const createShiftSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{0,9}$/, 'Letters and digits, up to 10, e.g. GEN'),
  ...shiftFields,
  graceMinutes: shiftFields.graceMinutes.default(15),
}).strict().superRefine(refineTimes);
export type CreateShiftInput = z.infer<typeof createShiftSchema>;

/**
 * Change a shift. Its times apply to every day it is rostered on, past days
 * included, until attendance for a month is locked (ATT-09); the lock is what
 * payroll reads, so a change after it moves nothing that has been paid.
 */
export const updateShiftSchema = z.object({
  ...shiftFields,
  isActive: z.boolean(),
}).partial().strict().superRefine(refineTimes);
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;

/**
 * Put someone on a shift, with their weekly offs, from a date (ATT-04). It holds
 * until their next roster entry starts. A second entry on the same date replaces
 * the first.
 */
export const assignRosterSchema = z.object({
  employeeId: z.string().uuid(),
  shiftId: z.string().uuid('Pick a shift'),
  effectiveFrom: z.string().date('Pick the first day'),
  weeklyOffDays: weeklyOffDaysSchema,
}).strict();
export type AssignRosterInput = z.infer<typeof assignRosterSchema>;

export const PUNCH_DIRECTIONS = ['IN', 'OUT'] as const;
export type PunchDirection = (typeof PUNCH_DIRECTIONS)[number];

/**
 * Punch in or out from the browser (ATT-02). The direction is what the person
 * meant to do, so a second click on a stale page is refused rather than taken
 * as the opposite punch.
 *
 * There is no time in here, and `.strict()` refuses one: the server's clock
 * decides when a web punch happened. A time the browser could send is a time
 * anyone could choose.
 */
export const punchSchema = z.object({
  direction: z.enum(PUNCH_DIRECTIONS),
}).strict();
export type PunchInput = z.infer<typeof punchSchema>;

/** A range of attendance days to read punches for: two months at most. */
export const punchRangeSchema = z.object({
  from: z.string().date('A date, as YYYY-MM-DD'),
  to: z.string().date('A date, as YYYY-MM-DD'),
}).strict().superRefine((range, ctx) => {
  if (range.to < range.from) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Ends before it starts' });
    return;
  }
  const spanDays = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000;
  if (spanDays > 62) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'At most two months at a time' });
});
export type PunchRangeInput = z.infer<typeof punchRangeSchema>;
