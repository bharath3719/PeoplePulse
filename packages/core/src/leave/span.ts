import {
  addDays, leaveYearOf, weekdayOf, istDate, type IstDate, type LeaveYear,
} from '../date/india';
import { HALF_DAY, dayHundredths, type DayHundredths } from './units';

/**
 * What a leave request covers, in half-day SESSIONS.
 *
 * Each date has two: FIRST (morning) and SECOND (afternoon). A request runs from
 * one session to another, inclusive, which says everything a half day needs
 * without a separate "is this a half day" flag that can disagree with the dates:
 *
 *   3 Nov FIRST  -> 5 Nov SECOND   three full days
 *   3 Nov SECOND -> 5 Nov SECOND   two and a half — starts after lunch on the 3rd
 *   3 Nov FIRST  -> 3 Nov FIRST    the morning of the 3rd
 *   3 Nov SECOND -> 3 Nov SECOND   the afternoon of the 3rd
 *   3 Nov SECOND -> 3 Nov FIRST    nothing, and refused
 *
 * Attendance will need to know WHICH half was taken (ATT-08 marks the day ½),
 * and a bare "0.5 days" cannot tell it.
 */
export const SESSIONS = ['FIRST', 'SECOND'] as const;
export type Session = (typeof SESSIONS)[number];

export interface LeaveSpan {
  readonly startDate: IstDate;
  readonly startSession: Session;
  readonly endDate: IstDate;
  readonly endSession: Session;
}

/**
 * How a leave type counts the days in a span.
 *
 *   WORKING_DAYS   weekly offs and holidays inside the span are not leave. A
 *                  Friday-to-Monday casual leave is two days, not four.
 *   CALENDAR_DAYS  every day counts. Maternity leave is 26 WEEKS under the
 *                  Maternity Benefit Act 1961 (as amended in 2017) — calendar
 *                  weeks, Sundays and holidays included — so counting it in
 *                  working days would quietly lengthen it.
 */
export const DAY_COUNT_BASES = ['WORKING_DAYS', 'CALENDAR_DAYS'] as const;
export type DayCountBasis = (typeof DAY_COUNT_BASES)[number];

/** Which days an employee was not due at work anyway. */
export interface WorkingCalendar {
  /** 0 = Sunday .. 6 = Saturday. The company's weekly offs until rosters (ATT-04) replace them. */
  readonly weeklyOffDays: readonly number[];
  /** Holidays at the employee's location, plus company-wide ones. */
  readonly holidays: ReadonlySet<string>;
}

export class LeaveSpanError extends Error {}

/** The longest span we will count. A year and a day is already a typo, not leave. */
const MAX_SPAN_DAYS = 366;

export function assertValidSpan(span: LeaveSpan): void {
  if (span.endDate < span.startDate) {
    throw new LeaveSpanError('The leave ends before it starts');
  }
  if (span.startDate === span.endDate && span.startSession === 'SECOND' && span.endSession === 'FIRST') {
    throw new LeaveSpanError('A day cannot start in the afternoon and end in the morning');
  }
  if (leaveYearOf(span.startDate) !== leaveYearOf(span.endDate)) {
    // Each leave year has its own balance (D-17), so a span across New Year
    // draws on two of them. Two requests say which days come from which.
    throw new LeaveSpanError(
      `Leave cannot run across the new year — apply up to 31 Dec ${leaveYearOf(span.startDate)} and again from 1 Jan`,
    );
  }
}

/** The leave year a valid span draws from. A valid span never straddles two. */
export function leaveYearOfSpan(span: LeaveSpan): LeaveYear {
  return leaveYearOf(span.startDate);
}

/** True if the span takes any part of a day off: the first or last day is a half. */
export function isPartDay(span: LeaveSpan): boolean {
  return span.startSession === 'SECOND' || span.endSession === 'FIRST';
}

/**
 * How much leave a span is.
 *
 * Counted session by session, so a half day that lands on a weekly off costs
 * nothing, exactly like a full day there would.
 */
export function countLeaveDays(
  span: LeaveSpan,
  basis: DayCountBasis,
  calendar: WorkingCalendar,
): DayHundredths {
  assertValidSpan(span);

  let sessions = 0;
  let date = span.startDate;
  for (let i = 0; date <= span.endDate; i += 1, date = addDays(date, 1)) {
    if (i >= MAX_SPAN_DAYS) throw new LeaveSpanError('Leave can cover at most a year');

    if (basis === 'WORKING_DAYS' && isDayOff(date, calendar)) continue;

    let today = 2;
    if (date === span.startDate && span.startSession === 'SECOND') today -= 1;
    if (date === span.endDate && span.endSession === 'FIRST') today -= 1;
    sessions += today;
  }

  return dayHundredths(sessions * HALF_DAY);
}

export function isDayOff(date: IstDate, calendar: WorkingCalendar): boolean {
  return calendar.weeklyOffDays.includes(weekdayOf(date)) || calendar.holidays.has(date);
}

/**
 * Do two spans share a session?
 *
 * By session, not by date: the morning of the 3rd and the afternoon of the 3rd
 * are two legitimate half days, and a date-level check would refuse the second.
 */
export function spansOverlap(a: LeaveSpan, b: LeaveSpan): boolean {
  return sessionIndex(a.startDate, a.startSession) <= sessionIndex(b.endDate, b.endSession)
    && sessionIndex(b.startDate, b.startSession) <= sessionIndex(a.endDate, a.endSession);
}

function sessionIndex(date: IstDate, session: Session): number {
  const day = Math.round(new Date(`${date}T00:00:00Z`).getTime() / 86_400_000);
  return day * 2 + (session === 'SECOND' ? 1 : 0);
}

/** For callers holding plain strings from a database row or a request body. */
export function toLeaveSpan(input: {
  startDate: string; startSession: Session; endDate: string; endSession: Session;
}): LeaveSpan {
  return {
    startDate: istDate(input.startDate),
    startSession: input.startSession,
    endDate: istDate(input.endDate),
    endSession: input.endSession,
  };
}
