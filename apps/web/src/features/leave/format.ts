import { formatDays, fromDays, leaveYearOf, toIstDate } from '@peoplepulse/core';
import { ApiError } from '@/lib/api';
import type { LeaveRequest } from './api/leave';

/** "1.5 days", "1 day", "0.5 day". */
export function showDays(days: number): string {
  return `${figure(days)} ${unit(days)}`;
}

/** The number alone — set in tabular figures where it sits in a column. */
export function figure(days: number): string {
  return formatDays(fromDays(days));
}

export function unit(days: number): 'day' | 'days' {
  return Math.abs(days) === 1 || Math.abs(days) === 0.5 ? 'day' : 'days';
}

const DATE = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "Tue, 3 Nov". An IST calendar date has no time, so it is formatted at UTC midnight and never shifts. */
export function formatDate(iso: string): string {
  return DATE.format(new Date(`${iso}T00:00:00Z`));
}

/** "Tue, 3 Nov – Thu, 5 Nov", with the half days spelled out. */
export function describeSpan(r: Pick<LeaveRequest, 'startDate' | 'startSession' | 'endDate' | 'endSession'>): string {
  if (r.startDate === r.endDate) {
    const half = r.startSession === 'SECOND' ? ' (second half)' : r.endSession === 'FIRST' ? ' (first half)' : '';
    return `${formatDate(r.startDate)}${half}`;
  }
  const from = `${formatDate(r.startDate)}${r.startSession === 'SECOND' ? ' (second half)' : ''}`;
  const to = `${formatDate(r.endDate)}${r.endSession === 'FIRST' ? ' (first half)' : ''}`;
  return `${from} – ${to}`;
}

export function thisLeaveYear(): number {
  return leaveYearOf(toIstDate(new Date()));
}

export function today(): string {
  return toIstDate(new Date());
}

/** 0 = Sunday, the numbering weekly offs are stored in. */
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const ENTRY_KINDS: Record<string, string> = {
  OPENING: 'Opening balance',
  GRANT: 'Yearly grant',
  ACCRUAL: 'Monthly accrual',
  ADJUSTMENT: 'Adjustment',
  DEBIT: 'Leave taken',
  REVERSAL: 'Leave cancelled',
};

/** The sentence to show for a failed call: a field's message if the API blamed one, else its own. */
export function problem(error: Error): string {
  return error instanceof ApiError ? (error.fieldErrors[0]?.message ?? error.message) : error.message;
}
