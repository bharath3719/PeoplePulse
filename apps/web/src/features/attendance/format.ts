import { addDays, istDate, toIstDate } from '@peoplepulse/core';
import { WEEKDAYS } from '@/features/leave/format';
import type { ShiftRef } from './api/attendance';

const TIME = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata',
});

/** "09:12" — a punch's instant on the IST clock, wherever the browser is. */
export function punchTime(iso: string): string {
  return TIME.format(new Date(iso));
}

/** "General, 09:30–18:30", with "overnight" for a shift that ends the next morning. */
export function describeShift(shift: Pick<ShiftRef, 'name' | 'startTime' | 'endTime'>): string {
  const overnight = shift.endTime <= shift.startTime ? ' overnight' : '';
  return `${shift.name}, ${shift.startTime}–${shift.endTime}${overnight}`;
}

/** "Sat, Sun off", or "No weekly off". */
export function describeWeeklyOffs(days: readonly number[]): string {
  if (days.length === 0) return 'No weekly off';
  return `${days.map((d) => WEEKDAYS[d]!.slice(0, 3)).join(', ')} off`;
}

/** "2h 05m" from minutes. */
export function hoursAndMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** The last `count` IST dates, ending today: [from, to]. */
export function lastDays(count: number): [string, string] {
  const to = toIstDate(new Date());
  return [addDays(istDate(to), -(count - 1)), to];
}
