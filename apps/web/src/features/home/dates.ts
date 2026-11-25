import { today } from '@/features/leave/format';

/**
 * Calendar arithmetic on IST dates ("YYYY-MM-DD"), done at UTC midnight so no
 * timezone can move a date. Display only: nothing here feeds a balance.
 */
const DAY_MS = 86_400_000;

export function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** "today", "tomorrow", "in 12 days". */
export function relativeDays(date: string, from = today()): string {
  const n = daysFrom(from, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * The next anniversary of `date` on or after `from`, and which one it is.
 * Someone who joined on 29 February has theirs on the 28th in other years.
 */
export function nextAnniversary(date: string, from = today()): { on: string; years: number } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const fromYear = Number(from.slice(0, 4));
  const on = (year: number) => {
    const day = m === 2 && d === 29 && !isLeap(year) ? 28 : d;
    return `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  const year = on(fromYear) >= from ? fromYear : fromYear + 1;
  return { on: on(year), years: year - y };
}

const LONG = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

/** "Tuesday, 25 November", on the IST calendar. */
export function longToday(): string {
  return LONG.format(new Date());
}

/** Morning, afternoon or evening — on the IST clock, where the company is. */
export function partOfDay(): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date()));
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });

/** The parts of a date tile: "25", "Dec". */
export function dateTile(date: string): { day: string; month: string } {
  return { day: String(Number(date.slice(8, 10))), month: MONTH.format(new Date(`${date}T00:00:00Z`)) };
}
