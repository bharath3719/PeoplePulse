/**
 * Month arithmetic for the calendar views (attendance and leave). Dates are IST
 * calendar dates, "YYYY-MM-DD", handled at UTC midnight so no timezone can move
 * one. Months are "YYYY-MM". Display only: nothing here counts leave or pay.
 */
export type Month = string;

const DAY_MS = 86_400_000;
const at = (date: string) => Date.parse(`${date}T00:00:00Z`);

export const monthOf = (date: string): Month => date.slice(0, 7);

/** Every date in the month, in order. */
export function datesIn(month: Month): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export function shiftMonth(month: Month, by: number): Month {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_LABEL = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "November 2026". */
export const monthLabel = (month: Month) => MONTH_LABEL.format(new Date(`${month}-01T00:00:00Z`));

/** 0 = Sunday, the numbering weekly offs are stored in. */
export const weekdayOf = (date: string) => new Date(at(date)).getUTCDay();

export const dayOfMonth = (date: string) => Number(date.slice(8, 10));

/** Each date from `from` to `to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = at(from); t <= at(to); t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Weekday initials, Monday first: Indian offices count the week from Monday. */
export const WEEK_MONDAY_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Blank cells before the 1st in a Monday-first grid. */
export const leadingBlanks = (month: Month) => (weekdayOf(`${month}-01`) + 6) % 7;
