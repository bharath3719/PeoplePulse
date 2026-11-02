import {
  daysBetweenInclusive, daysInMonth, firstDayOfMonth, lastDayOfMonth, payrollMonth,
  type IstDate, type LeaveYear, type PayrollMonth,
} from '../date/india';
import { NO_DAYS, dayHundredths, roundRatio, type DayHundredths } from './units';

/**
 * How a leave type earns its balance (LVE-01, TR-15).
 *
 *   NONE     nothing is earned. LOP has no balance at all; maternity is granted
 *            by HR to the person it applies to, as an adjustment.
 *   MONTHLY  a twelfth of the annual entitlement each month the person is
 *            employed — earned leave, typically.
 *   YEARLY   the whole year's entitlement at once, at the start of the leave
 *            year or on joining — casual and sick leave, typically.
 */
export const ACCRUAL_FREQUENCIES = ['NONE', 'MONTHLY', 'YEARLY'] as const;
export type AccrualFrequency = (typeof ACCRUAL_FREQUENCIES)[number];

/** The dates that bound what someone can earn. `exitDate` null while they are still here. */
export interface Tenure {
  readonly joinDate: IstDate;
  readonly exitDate: IstDate | null;
}

/**
 * The least common multiple of 28, 29, 30 and 31. Every "days employed out of
 * days in this month" fraction becomes an exact integer over this, so a year
 * of fractions adds up in integer arithmetic.
 */
const MONTH_LCM = 377_580;

/**
 * How much of a month someone was employed, as an integer over MONTH_LCM.
 * MONTH_LCM itself means the whole month; joining on the 16th of a 31-day month
 * gives 16/31 of it. Pro-rata by calendar days, as TR-15 asks, so the join
 * month is neither a full month's credit for one day's work nor nothing.
 */
function employedShare(month: PayrollMonth, tenure: Tenure): number {
  const first = firstDayOfMonth(month);
  const last = lastDayOfMonth(month);
  const from = tenure.joinDate > first ? tenure.joinDate : first;
  const to = tenure.exitDate !== null && tenure.exitDate < last ? tenure.exitDate : last;
  if (to < from) return 0;
  return (daysBetweenInclusive(from, to) * MONTH_LCM) / daysInMonth(month);
}

function monthOf(year: LeaveYear, month: number): PayrollMonth {
  return payrollMonth(`${year}-${String(month).padStart(2, '0')}`);
}

/** Entitlement earned from January through `throughMonth`, before rounding, as n / (12 * MONTH_LCM). */
function earnedNumerator(annual: DayHundredths, year: LeaveYear, throughMonth: number, tenure: Tenure): number {
  let shares = 0;
  for (let m = 1; m <= throughMonth; m += 1) shares += employedShare(monthOf(year, m), tenure);
  return annual * shares;
}

/**
 * One month's credit under a MONTHLY policy.
 *
 * Rounded CUMULATIVELY: the credit for a month is what has been earned so far
 * this year, rounded, less what had been earned by last month, rounded. A
 * 10-day policy therefore credits 0.83, 0.84, 0.83 ... and the year comes to
 * exactly 10.00. Rounding each month on its own would credit 0.83 twelve times
 * and leave everyone 0.04 of a day short every year, with nothing to show why.
 *
 * Earnings restart each leave year: carry-forward from the year before is a
 * ledger entry of its own (LVE-02), not a continuation of this sum.
 */
export function monthlyAccrual(annual: DayHundredths, month: PayrollMonth, tenure: Tenure): DayHundredths {
  const year = Number(month.slice(0, 4)) as LeaveYear;
  const m = Number(month.slice(5, 7));
  const denominator = 12 * MONTH_LCM;

  const through = roundRatio(earnedNumerator(annual, year, m, tenure), denominator);
  const before = roundRatio(earnedNumerator(annual, year, m - 1, tenure), denominator);
  return dayHundredths(through - before);
}

/**
 * The single grant under a YEARLY policy.
 *
 * With pro-rata, someone joining on 1 July is granted half the year, and
 * someone whose exit date is already known gets only the months up to it. The
 * months are weighted by calendar days, as monthly accrual weights them, so the
 * two policies agree about what a partial year is worth.
 *
 * Without pro-rata, anyone employed for any part of the year gets all of it.
 * A front-loaded grant is not clawed back on exit here: recovering leave taken
 * beyond what was earned is full-and-final settlement's job (PAY-08).
 */
export function yearlyGrant(
  annual: DayHundredths,
  year: LeaveYear,
  tenure: Tenure,
  proRata: boolean,
): DayHundredths {
  const numerator = earnedNumerator(annual, year, 12, tenure);
  if (numerator === 0) return NO_DAYS;
  if (!proRata) return annual;
  return dayHundredths(roundRatio(numerator, 12 * MONTH_LCM));
}
