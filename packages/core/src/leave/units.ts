/**
 * Leave quantities. Read this before adding up a balance.
 *
 * Every leave quantity in PeoplePulse is an INTEGER NUMBER OF HUNDREDTHS OF A
 * DAY: 150 is a day and a half, 125 is one month of a 15-day-a-year policy.
 *
 * Why not days as a plain number: a balance is a SUM of ledger entries, and
 * policies accrue in fractions that binary floating point cannot hold. Twelve
 * monthly credits of a 10-day policy, each 10/12 of a day, add up to
 * 9.999999999999998 — which displays as 10.00 right up until encashment
 * multiplies it by a daily wage. Leave turns into money twice, as LOP and as
 * encashment (PAY-03, PAY-08), so it gets the treatment money gets (ADR-005):
 * integers, a branded type, and rounding that happens in one named place.
 *
 * Hundredths rather than half-days, because accruals are finer than requests.
 * A request is always a multiple of 50; a monthly credit may be 83.
 */

/** An integer number of hundredths of a day. 100 = one day. */
export type DayHundredths = number & { readonly __brand: 'DayHundredths' };

export const FULL_DAY = 100 as DayHundredths;
export const HALF_DAY = 50 as DayHundredths;
export const NO_DAYS = 0 as DayHundredths;

export class LeaveUnitError extends Error {}

export function dayHundredths(value: number): DayHundredths {
  if (!Number.isSafeInteger(value)) {
    throw new LeaveUnitError(`leave quantity must be a whole number of hundredths, got ${value}`);
  }
  return value as DayHundredths;
}

/**
 * Days as a person writes them -> hundredths. The boundary only: a form, an
 * import. Rounded at once so the float never travels — 0.07 * 100 is
 * 7.000000000000001.
 */
export function fromDays(days: number): DayHundredths {
  if (!Number.isFinite(days)) throw new LeaveUnitError(`days is not finite: ${days}`);
  const scaled = days * 100;
  return dayHundredths(scaled < 0 ? -Math.round(-scaled) : Math.round(scaled));
}

/** Hundredths -> days. Display and export ONLY; never feed it back in. */
export function toDays(value: DayHundredths): number {
  return value / 100;
}

/** "1.5", "6.25", "12", "-2" — no trailing zeros, because people read days that way. */
export function formatDays(value: DayHundredths): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100);
  const fractional = abs % 100;
  const text = fractional === 0
    ? String(whole)
    : `${whole}.${String(fractional).padStart(2, '0').replace(/0$/, '')}`;
  return negative ? `-${text}` : text;
}

export function sumDays(values: readonly DayHundredths[]): DayHundredths {
  return dayHundredths(values.reduce<number>((total, v) => total + v, 0));
}

/**
 * Round a non-negative ratio of integers to the nearest integer, half up, in
 * integer arithmetic. `Math.round(n / d)` divides in floating point first, and
 * a true x.5 can arrive as x.4999999 and round down.
 */
export function roundRatio(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new LeaveUnitError(`roundRatio needs safe integers, got ${numerator}/${denominator}`);
  }
  if (numerator < 0 || denominator <= 0) {
    throw new LeaveUnitError(`roundRatio needs n >= 0 and d > 0, got ${numerator}/${denominator}`);
  }
  // floor((2n + d) / 2d), with the remainder taken off first so that the one
  // division left is exact.
  const twice = 2 * numerator + denominator;
  return (twice - (twice % (2 * denominator))) / (2 * denominator);
}
