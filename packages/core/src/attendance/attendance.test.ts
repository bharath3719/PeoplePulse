import { describe, it, expect } from 'vitest';
import { istDate, toIstDate, type IstDate } from '../date/india';
import {
  attendanceDateOf, crossesMidnight, formatClock, parseClock, shiftLengthMinutes, ClockError,
  type ShiftResolver, type ShiftTimes,
} from './shift';
import { rosterOn } from './roster';
import { DEFAULT_SHIFT } from './defaults';
import { countLeaveDays, toLeaveSpan, weeklyOffDaysOn, type WorkingCalendar } from '../leave/span';
import { assignRosterSchema, createShiftSchema, punchRangeSchema, punchSchema } from '../validation/attendance';

/** An instant, written as IST wall-clock time: '2026-07-13 22:00'. */
function ist(wallClock: string): Date {
  return new Date(`${wallClock.replace(' ', 'T')}:00+05:30`);
}

function shift(start: string, end: string): ShiftTimes {
  return { startMinute: parseClock(start), endMinute: parseClock(end) };
}

const DAY = shift('09:30', '18:30');
const NIGHT = shift('22:00', '06:00');

const always = (s: ShiftTimes | null): ShiftResolver => () => s;
/** A different shift on each named date; `otherwise` for the rest. */
function byDate(dates: Record<string, ShiftTimes | null>, otherwise: ShiftTimes | null = null): ShiftResolver {
  return (date: IstDate) => (date in dates ? dates[date]! : otherwise);
}

describe('shift times are minutes past IST midnight', () => {
  it('converts at the edge', () => {
    expect(parseClock('09:30')).toBe(570);
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('23:59')).toBe(1439);
    expect(formatClock(570)).toBe('09:30');
    expect(formatClock(0)).toBe('00:00');
  });

  it('refuses what is not a 24-hour HH:MM', () => {
    for (const bad of ['9:30', '24:00', '12:60', '0930', '']) expect(() => parseClock(bad)).toThrow(ClockError);
    expect(() => formatClock(1440)).toThrow(ClockError);
    expect(() => formatClock(1.5)).toThrow(ClockError);
  });

  it('knows a night shift from its times alone', () => {
    expect(crossesMidnight(DAY)).toBe(false);
    expect(crossesMidnight(NIGHT)).toBe(true);
    expect(shiftLengthMinutes(DAY)).toBe(540);
    expect(shiftLengthMinutes(NIGHT)).toBe(480);
  });

  it('starts every company on a 09:30-18:30 day with 15 minutes grace', () => {
    expect(formatClock(DEFAULT_SHIFT.startMinute)).toBe('09:30');
    expect(formatClock(DEFAULT_SHIFT.endMinute)).toBe('18:30');
    expect(crossesMidnight(DEFAULT_SHIFT)).toBe(false);
  });
});

describe('which attendance day a punch belongs to (D-17)', () => {
  it('files a day-shift punch under the day it happened', () => {
    expect(attendanceDateOf(ist('2026-07-13 09:20'), always(DAY))).toBe('2026-07-13');
    expect(attendanceDateOf(ist('2026-07-13 18:45'), always(DAY))).toBe('2026-07-13');
  });

  it('files BOTH ends of a night shift under the day the shift STARTED', () => {
    const punchIn = ist('2026-07-13 21:55');
    const punchOut = ist('2026-07-14 06:10');

    // Naively these are two different dates ...
    expect(toIstDate(punchOut)).toBe('2026-07-14');
    // ... but one shift. Otherwise both days show a missing punch, and LOP is
    // wrong twice instead of right once.
    expect(attendanceDateOf(punchIn, always(NIGHT))).toBe('2026-07-13');
    expect(attendanceDateOf(punchOut, always(NIGHT))).toBe('2026-07-13');
  });

  it('turns over at the midpoint between last night\'s end and tonight\'s start', () => {
    // 06:00 to 22:00: the boundary is 14:00.
    expect(attendanceDateOf(ist('2026-07-14 13:59'), always(NIGHT))).toBe('2026-07-13');
    expect(attendanceDateOf(ist('2026-07-14 14:00'), always(NIGHT))).toBe('2026-07-14');
  });

  it('gives a day-shift worker\'s after-midnight punch to the evening it ended', () => {
    // 18:30 to 09:30 the next day: the boundary is 02:00.
    expect(attendanceDateOf(ist('2026-07-14 00:40'), always(DAY))).toBe('2026-07-13');
    expect(attendanceDateOf(ist('2026-07-14 02:00'), always(DAY))).toBe('2026-07-14');
  });

  it('does not take the morning after a night shift for the tail of it when a day shift starts', () => {
    // Night on the 13th, day shift from the 14th: 06:00 to 09:30, boundary 07:45.
    const roster = byDate({ '2026-07-13': NIGHT }, DAY);
    expect(attendanceDateOf(ist('2026-07-14 06:20'), roster)).toBe('2026-07-13');
    expect(attendanceDateOf(ist('2026-07-14 08:45'), roster)).toBe('2026-07-14');
  });

  it('uses the calendar date when nobody is rostered at all', () => {
    expect(attendanceDateOf(ist('2026-07-14 00:40'), always(null))).toBe('2026-07-14');
  });

  it('still closes off yesterday\'s night shift when today has none', () => {
    // Nothing today: the boundary is midway between 06:00 and midnight, 15:00.
    const roster = byDate({ '2026-07-13': NIGHT });
    expect(attendanceDateOf(ist('2026-07-14 06:30'), roster)).toBe('2026-07-13');
    expect(attendanceDateOf(ist('2026-07-14 15:00'), roster)).toBe('2026-07-14');
  });
});

describe('a roster is a timeline of changes', () => {
  const entries = [
    { effectiveFrom: '2026-03-03', weeklyOffDays: [0], shift: 'NIGHT' },
    { effectiveFrom: '2026-01-01', weeklyOffDays: [0], shift: 'GEN' },
    { effectiveFrom: '2026-04-06', weeklyOffDays: [0, 6], shift: 'GEN' },
  ];

  it('applies the latest entry starting on or before the date, in any order', () => {
    expect(rosterOn(entries, '2026-03-02')?.shift).toBe('GEN');
    expect(rosterOn(entries, '2026-03-03')?.shift).toBe('NIGHT');
    expect(rosterOn(entries, '2026-04-05')?.shift).toBe('NIGHT');
    expect(rosterOn(entries, '2026-12-31')?.weeklyOffDays).toEqual([0, 6]);
  });

  it('has nothing before the first entry, so the company default applies', () => {
    expect(rosterOn(entries, '2025-12-31')).toBeNull();
    expect(rosterOn([], '2026-06-01')).toBeNull();
  });
});

describe('leave counts the roster\'s weekly offs, not just the company\'s', () => {
  // November 2026: the 1st is a Sunday. The company is off on Sundays; from
  // the 9th, this person is rostered Tuesday and Wednesday off instead.
  const calendar: WorkingCalendar = {
    weeklyOffDays: [0],
    roster: [{ effectiveFrom: '2026-11-09', weeklyOffDays: [2, 3] }],
    holidays: new Set(),
  };
  const week = (start: string, end: string) =>
    countLeaveDays(toLeaveSpan({ startDate: start, startSession: 'FIRST', endDate: end, endSession: 'SECOND' }), 'WORKING_DAYS', calendar);

  it('uses the company\'s weekly offs before the roster starts', () => {
    // Mon 2 to Sun 8: Sunday off, six days.
    expect(week('2026-11-02', '2026-11-08')).toBe(600);
    expect(weeklyOffDaysOn(istDate('2026-11-08'), calendar)).toEqual([0]);
  });

  it('uses the roster\'s once it has — Sunday is a working day for them now', () => {
    // Mon 9 to Sun 15: Tuesday and Wednesday off, five days, Sunday counted.
    expect(week('2026-11-09', '2026-11-15')).toBe(500);
    expect(weeklyOffDaysOn(istDate('2026-11-15'), calendar)).toEqual([2, 3]);
  });
});

describe('attendance validation', () => {
  it('reads a shift\'s times as HH:MM and refuses one that ends when it starts', () => {
    expect(createShiftSchema.parse({ code: 'night', name: 'Night', startTime: '22:00', endTime: '06:00' }))
      .toEqual({ code: 'NIGHT', name: 'Night', startTime: '22:00', endTime: '06:00', graceMinutes: 15 });
    expect(createShiftSchema.safeParse({ code: 'X', name: 'X', startTime: '09:00', endTime: '09:00' }).success).toBe(false);
    expect(createShiftSchema.safeParse({ code: 'X', name: 'X', startTime: '9:00', endTime: '18:00' }).success).toBe(false);
  });

  it('takes no time from the browser for a punch', () => {
    expect(punchSchema.parse({ direction: 'IN' })).toEqual({ direction: 'IN' });
    expect(punchSchema.safeParse({ direction: 'IN', punchedAt: '2026-07-13T03:00:00Z' }).success).toBe(false);
  });

  it('dedupes weekly offs and leaves at least one working day', () => {
    const base = { employeeId: crypto.randomUUID(), shiftId: crypto.randomUUID(), effectiveFrom: '2026-11-09' };
    expect(assignRosterSchema.parse({ ...base, weeklyOffDays: [3, 2, 2] }).weeklyOffDays).toEqual([2, 3]);
    expect(assignRosterSchema.safeParse({ ...base, weeklyOffDays: [0, 1, 2, 3, 4, 5, 6] }).success).toBe(false);
  });

  it('reads punches two months at a time at most', () => {
    expect(punchRangeSchema.safeParse({ from: '2026-01-01', to: '2026-03-01' }).success).toBe(true);
    expect(punchRangeSchema.safeParse({ from: '2026-01-01', to: '2026-03-15' }).success).toBe(false);
    expect(punchRangeSchema.safeParse({ from: '2026-03-01', to: '2026-01-01' }).success).toBe(false);
  });
});
