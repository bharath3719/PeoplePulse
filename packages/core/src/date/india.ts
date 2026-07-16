/**
 * Dates. India has two different years and they are both in this system.
 *
 *   Financial year  April -> March   TDS, Form 16, investment declarations.
 *   Leave year      January -> December   leave accrual, carry-forward, encashment.
 *
 * They are deliberately different (OPEN.md D-17). A column called `year` is
 * therefore always ambiguous and always a bug waiting to happen — say which
 * one you mean: `financialYear` or `leaveYear`.
 *
 * Storage is UTC. Display and all business rules are IST (UTC+5:30).
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;
const MS_PER_MINUTE = 60_000;

/** A calendar date in IST, with no time component. "2026-07-13". */
export type IstDate = string & { readonly __brand: 'IstDate' };

export class DateError extends Error {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function istDate(value: string): IstDate {
  if (!ISO_DATE.test(value)) throw new DateError(`not an ISO date (YYYY-MM-DD): "${value}"`);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new DateError(`not a real date: "${value}"`);
  // Round-trip guard: rejects 2026-02-30, which Date silently rolls forward.
  if (d.toISOString().slice(0, 10) !== value) throw new DateError(`not a real date: "${value}"`);
  return value as IstDate;
}

/**
 * The IST calendar date an instant falls on.
 *
 * This is the function that decides which day a punch belongs to, so it is
 * worth being exact: a punch stored as 2026-07-13T19:30:00Z is 2026-07-14
 * at 01:00 IST, and belongs to the 14th.
 */
export function toIstDate(instant: Date): IstDate {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);
  return shifted.toISOString().slice(0, 10) as IstDate;
}

/** Minutes past IST midnight. Used by shift and grace-period rules. */
export function istMinutesOfDay(instant: Date): number {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

// ---------------------------------------------------------------------------
// Financial year (April -> March)
// ---------------------------------------------------------------------------

/** "2026-27" — the FY a date falls in. April 2026 through March 2027. */
export type FinancialYear = string & { readonly __brand: 'FinancialYear' };

export function financialYearOf(date: IstDate): FinancialYear {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)); // 1-12

  // Jan/Feb/Mar belong to the FY that STARTED the previous April.
  const startYear = month >= 4 ? year : year - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endShort}` as FinancialYear;
}

export function financialYearStart(fy: FinancialYear): IstDate {
  return istDate(`${fy.slice(0, 4)}-04-01`);
}

export function financialYearEnd(fy: FinancialYear): IstDate {
  return istDate(`${Number(fy.slice(0, 4)) + 1}-03-31`);
}

// ---------------------------------------------------------------------------
// Leave year (January -> December)
// ---------------------------------------------------------------------------

/** The calendar year a date falls in. Leave accrual and carry-forward use this. */
export type LeaveYear = number & { readonly __brand: 'LeaveYear' };

export function leaveYearOf(date: IstDate): LeaveYear {
  return Number(date.slice(0, 4)) as LeaveYear;
}

// ---------------------------------------------------------------------------
// ESI contribution periods (April -> September, October -> March)
// ---------------------------------------------------------------------------

/**
 * ESI coverage is fixed at the START of a contribution period and holds until
 * that period ENDS, even if the employee's wage crosses the threshold in the
 * middle of it (TRD TR-21, ADR-004).
 *
 * This is why ESI coverage can never be recomputed from the current month's
 * wage: it is a fact established at a point in time and carried forward.
 */
export type EsiContributionPeriod = 'APR_SEP' | 'OCT_MAR';

export function esiContributionPeriodOf(date: IstDate): EsiContributionPeriod {
  const month = Number(date.slice(5, 7));
  return month >= 4 && month <= 9 ? 'APR_SEP' : 'OCT_MAR';
}

/** The first day of the contribution period a date falls in. */
export function esiContributionPeriodStart(date: IstDate): IstDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (month >= 4 && month <= 9) return istDate(`${year}-04-01`);
  // Oct-Dec starts this October; Jan-Mar started LAST October.
  return istDate(`${month >= 10 ? year : year - 1}-10-01`);
}

// ---------------------------------------------------------------------------
// Payroll months
// ---------------------------------------------------------------------------

/** "2026-07" — the month a payroll run is for. */
export type PayrollMonth = string & { readonly __brand: 'PayrollMonth' };

export function payrollMonth(value: string): PayrollMonth {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new DateError(`not a payroll month (YYYY-MM): "${value}"`);
  }
  return value as PayrollMonth;
}

export function payrollMonthOf(date: IstDate): PayrollMonth {
  return date.slice(0, 7) as PayrollMonth;
}

/**
 * Calendar days in a month.
 *
 * Payroll pro-rata divides by this (TR-20 step 3), so February and the
 * 31-day months genuinely produce different daily rates. That is correct
 * and intended — do not "normalise" it to 30.
 */
export function daysInMonth(month: PayrollMonth): number {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

export function firstDayOfMonth(month: PayrollMonth): IstDate {
  return istDate(`${month}-01`);
}

export function lastDayOfMonth(month: PayrollMonth): IstDate {
  return istDate(`${month}-${String(daysInMonth(month)).padStart(2, '0')}`);
}

// ---------------------------------------------------------------------------
// Attendance day resolution — the night-shift rule
// ---------------------------------------------------------------------------

/**
 * Which attendance day does a punch belong to?
 *
 * For a DAY shift, the answer is boring: the IST date it happened on.
 *
 * For a NIGHT shift it is not. An employee on 22:00-06:00 punches IN at 22:00
 * on the 13th and OUT at 06:00 on the 14th. If each punch were filed under the
 * day it occurred, BOTH days would show a missing punch, both would be flagged,
 * and LOP would be wrong twice instead of right once.
 *
 * The rule (OPEN.md D-17): a night shift's attendance day is the day the SHIFT
 * STARTED. A punch that lands before the shift's cutover hour is attributed
 * back to the previous day.
 *
 * `cutoverHour` is the IST hour before which a punch still belongs to
 * yesterday's night shift. For a 22:00-06:00 shift, something around 12 (noon)
 * is sane: anything before noon is the tail of last night's shift.
 */
export function attendanceDayOf(
  instant: Date,
  shift: { isNight: boolean; cutoverHour: number },
): IstDate {
  const date = toIstDate(instant);
  if (!shift.isNight) return date;

  const hour = Math.floor(istMinutesOfDay(instant) / 60);
  if (hour >= shift.cutoverHour) return date;

  return addDays(date, -1);
}

export function addDays(date: IstDate, days: number): IstDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10) as IstDate;
}

/** Inclusive day count. 13th to 13th is 1 day, not 0. */
export function daysBetweenInclusive(from: IstDate, to: IstDate): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}
