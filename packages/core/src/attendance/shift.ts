import { addDays, istMinutesOfDay, toIstDate, type IstDate } from '../date/india';

/**
 * Shifts (ATT-04): when someone is due at work, as minutes past IST midnight.
 *
 * Minutes, not "09:30" strings, for the reason leave is hundredths of a day:
 * lateness, half days and overtime are all comparisons and differences of these
 * numbers. "HH:MM" exists only at the edge — the form, the API body, the screen
 * — through `parseClock` and `formatClock`, and nowhere in between.
 *
 * A shift whose end is at or before its start runs past midnight: 22:00-06:00
 * ends at 06:00 the next morning. That is the whole definition of a night
 * shift here. There is no separate "is night" flag to disagree with the times.
 */
export interface ShiftTimes {
  /** 0..1439, IST. */
  readonly startMinute: number;
  /** 0..1439, IST. At or before startMinute means the next day. */
  readonly endMinute: number;
}

export const MINUTES_PER_DAY = 24 * 60;

export class ClockError extends Error {}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "09:30" -> 570. Twenty-four hour clock, always two digits each side. */
export function parseClock(value: string): number {
  const match = CLOCK.exec(value);
  if (!match) throw new ClockError(`not a time (HH:MM, 24-hour): "${value}"`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 570 -> "09:30". */
export function formatClock(minute: number): string {
  if (!Number.isInteger(minute) || minute < 0 || minute >= MINUTES_PER_DAY) {
    throw new ClockError(`not a minute of the day: ${minute}`);
  }
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** True for a shift that ends the morning after it starts. */
export function crossesMidnight(shift: ShiftTimes): boolean {
  return shift.endMinute <= shift.startMinute;
}

/** How long the shift is, start to end. 22:00-06:00 is 480. */
export function shiftLengthMinutes(shift: ShiftTimes): number {
  return crossesMidnight(shift)
    ? MINUTES_PER_DAY - shift.startMinute + shift.endMinute
    : shift.endMinute - shift.startMinute;
}

/**
 * The shift someone was rostered on for an attendance date. Null when there is
 * none: no roster entry, and the company has no default shift.
 */
export type ShiftResolver = (date: IstDate) => ShiftTimes | null;

/**
 * Which attendance day a punch belongs to.
 *
 * THE RULE (OPEN.md D-17, generalised here): a punch belongs to the nearer of
 * two shifts — yesterday's, or today's. The boundary is the midpoint of the gap
 * between yesterday's shift ending and today's starting. Before it, the punch is
 * the tail of yesterday's shift; from it, the start of today's.
 *
 *   Night shift 22:00-06:00 every day: yesterday's ends 06:00 today, today's
 *   starts 22:00, so the boundary is 14:00. Out at 06:10 -> yesterday. In at
 *   21:50 -> today. One shift, one attendance day — the day it STARTED, which is
 *   what D-17 rules. Otherwise both days show a missing punch and LOP is wrong
 *   twice instead of right once.
 *
 *   Day shift 09:30-18:30: yesterday's ended 18:30, today's starts 09:30, so the
 *   boundary is 02:00. Out at 00:40 after a long evening -> yesterday, where the
 *   work was. In at 09:20 -> today.
 *
 *   Night shift on the 13th, day shift 09:30 on the 14th: the boundary is 07:45,
 *   so the 14th's early arrival at 08:45 is the 14th's, not the tail of the 13th.
 *
 * With no shift either day the punch belongs to the IST date it happened on.
 * A punch is never filed under TOMORROW: a shift is taken to start no earlier
 * than midnight of its own date.
 */
export function attendanceDateOf(instant: Date, shiftOn: ShiftResolver): IstDate {
  const date = toIstDate(instant);
  const yesterday = addDays(date, -1);
  const previous = shiftOn(yesterday);
  if (!previous) return date;

  // Both measured in minutes from today's IST midnight; yesterday's end is
  // negative when it ended before midnight.
  const previousEnd = crossesMidnight(previous) ? previous.endMinute : previous.endMinute - MINUTES_PER_DAY;
  const today = shiftOn(date);
  const nextStart = today ? today.startMinute : MINUTES_PER_DAY;
  const boundary = nextStart > previousEnd ? (previousEnd + nextStart) / 2 : previousEnd;

  return istMinutesOfDay(instant) < boundary ? yesterday : date;
}
