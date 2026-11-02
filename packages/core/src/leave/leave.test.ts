import { describe, it, expect } from 'vitest';
import { istDate, payrollMonth, type LeaveYear } from '../date/india';
import {
  fromDays, toDays, formatDays, dayHundredths, roundRatio, sumDays, type DayHundredths,
} from './units';
import {
  countLeaveDays, spansOverlap, assertValidSpan, LeaveSpanError, toLeaveSpan,
  type LeaveSpan, type Session, type WorkingCalendar,
} from './span';
import { monthlyAccrual, yearlyGrant, type Tenure } from './accrual';
import { DEFAULT_LEAVE_TYPES } from './defaults';
import { applyLeaveSchema, createLeaveTypeSchema, leaveAdjustmentSchema } from '../validation/leave';

function span(
  startDate: string, endDate: string, startSession: Session = 'FIRST', endSession: Session = 'SECOND',
): LeaveSpan {
  return toLeaveSpan({ startDate, startSession, endDate, endSession });
}

// November 2026: the 1st is a Sunday, so the 7th/8th, 14th/15th ... are weekends.
const SUNDAYS_OFF: WorkingCalendar = { weeklyOffDays: [0], holidays: new Set() };
const WEEKENDS_OFF: WorkingCalendar = { weeklyOffDays: [0, 6], holidays: new Set() };

describe('leave quantities are integer hundredths of a day', () => {
  it('converts at the boundary without float drift', () => {
    expect(fromDays(1.5)).toBe(150);
    expect(fromDays(0.07)).toBe(7);    // 0.07 * 100 is 7.000000000000001
    expect(fromDays(6.25)).toBe(625);
    expect(fromDays(-2)).toBe(-200);
    expect(toDays(dayHundredths(625))).toBe(6.25);
  });

  it('formats the way people read days', () => {
    expect(formatDays(dayHundredths(1200))).toBe('12');
    expect(formatDays(dayHundredths(150))).toBe('1.5');
    expect(formatDays(dayHundredths(625))).toBe('6.25');
    expect(formatDays(dayHundredths(83))).toBe('0.83');
    expect(formatDays(dayHundredths(-50))).toBe('-0.5');
  });

  it('refuses fractional hundredths, which are always a bug', () => {
    expect(() => dayHundredths(12.5)).toThrow();
  });

  it('rounds ratios half up in integer arithmetic', () => {
    expect(roundRatio(1, 2)).toBe(1);   // 0.5 -> 1
    expect(roundRatio(5, 2)).toBe(3);   // 2.5 -> 3
    expect(roundRatio(4, 3)).toBe(1);
    expect(roundRatio(0, 7)).toBe(0);
  });
});

describe('counting a span', () => {
  it('counts working days, skipping weekly offs', () => {
    // Fri 6 Nov -> Mon 9 Nov with Sat+Sun off: Friday and Monday.
    expect(countLeaveDays(span('2026-11-06', '2026-11-09'), 'WORKING_DAYS', WEEKENDS_OFF)).toBe(200);
    // Same span where only Sunday is off: Saturday counts too.
    expect(countLeaveDays(span('2026-11-06', '2026-11-09'), 'WORKING_DAYS', SUNDAYS_OFF)).toBe(300);
  });

  it('skips holidays at the employee\'s location', () => {
    const withHoliday: WorkingCalendar = { weeklyOffDays: [0], holidays: new Set(['2026-11-10']) };
    expect(countLeaveDays(span('2026-11-09', '2026-11-11'), 'WORKING_DAYS', withHoliday)).toBe(200);
  });

  it('counts every day on a calendar-day basis — maternity\'s 26 weeks are calendar weeks', () => {
    expect(countLeaveDays(span('2026-11-06', '2026-11-09'), 'CALENDAR_DAYS', WEEKENDS_OFF)).toBe(400);
    // 26 weeks from 1 Jan: 182 days, weekends and all.
    expect(countLeaveDays(span('2026-01-01', '2026-07-01'), 'CALENDAR_DAYS', WEEKENDS_OFF)).toBe(18_200);
  });

  it('counts half days by session', () => {
    expect(countLeaveDays(span('2026-11-03', '2026-11-03', 'FIRST', 'FIRST'), 'WORKING_DAYS', SUNDAYS_OFF)).toBe(50);
    expect(countLeaveDays(span('2026-11-03', '2026-11-03', 'SECOND', 'SECOND'), 'WORKING_DAYS', SUNDAYS_OFF)).toBe(50);
    expect(countLeaveDays(span('2026-11-03', '2026-11-05', 'SECOND', 'SECOND'), 'WORKING_DAYS', SUNDAYS_OFF)).toBe(250);
    expect(countLeaveDays(span('2026-11-03', '2026-11-05', 'SECOND', 'FIRST'), 'WORKING_DAYS', SUNDAYS_OFF)).toBe(200);
  });

  it('charges nothing for a half day that falls on a weekly off', () => {
    // Starts Saturday afternoon, ends Monday morning, Sat+Sun off: only Monday's morning.
    expect(countLeaveDays(span('2026-11-07', '2026-11-09', 'SECOND', 'FIRST'), 'WORKING_DAYS', WEEKENDS_OFF)).toBe(50);
  });

  it('says a span of only days off is worth nothing', () => {
    expect(countLeaveDays(span('2026-11-07', '2026-11-08'), 'WORKING_DAYS', WEEKENDS_OFF)).toBe(0);
  });

  it('refuses a span that ends before it starts, or an afternoon-to-morning day', () => {
    expect(() => assertValidSpan(span('2026-11-05', '2026-11-04'))).toThrow(LeaveSpanError);
    expect(() => assertValidSpan(span('2026-11-05', '2026-11-05', 'SECOND', 'FIRST'))).toThrow(LeaveSpanError);
  });

  it('refuses a span across the new year — each year has its own balance (D-17)', () => {
    expect(() => assertValidSpan(span('2026-12-30', '2027-01-02'))).toThrow(/new year/);
  });
});

describe('overlap is by session, not by date', () => {
  it('lets the morning and the afternoon of one day be two requests', () => {
    expect(spansOverlap(
      span('2026-11-03', '2026-11-03', 'FIRST', 'FIRST'),
      span('2026-11-03', '2026-11-03', 'SECOND', 'SECOND'),
    )).toBe(false);
  });

  it('catches a half day inside a longer request', () => {
    expect(spansOverlap(
      span('2026-11-02', '2026-11-06'),
      span('2026-11-04', '2026-11-04', 'SECOND', 'SECOND'),
    )).toBe(true);
  });

  it('catches spans that share only their edge session', () => {
    expect(spansOverlap(
      span('2026-11-02', '2026-11-04', 'FIRST', 'FIRST'),
      span('2026-11-04', '2026-11-06', 'FIRST', 'SECOND'),
    )).toBe(true);
    expect(spansOverlap(
      span('2026-11-02', '2026-11-04', 'FIRST', 'FIRST'),
      span('2026-11-04', '2026-11-06', 'SECOND', 'SECOND'),
    )).toBe(false);
  });
});

const FULL_YEAR: Tenure = { joinDate: istDate('2020-01-01'), exitDate: null };
const YEAR = 2026 as LeaveYear;

function creditsFor(annual: DayHundredths, tenure: Tenure): number[] {
  return Array.from({ length: 12 }, (_, i) =>
    monthlyAccrual(annual, payrollMonth(`2026-${String(i + 1).padStart(2, '0')}`), tenure));
}

describe('monthly accrual', () => {
  it('credits a twelfth a month when a twelfth is exact', () => {
    expect(creditsFor(fromDays(12), FULL_YEAR)).toEqual(Array(12).fill(100));
    expect(creditsFor(fromDays(15), FULL_YEAR)).toEqual(Array(12).fill(125));
  });

  it('adds up to exactly the annual entitlement when a twelfth is NOT exact', () => {
    // The bug cumulative rounding prevents: 0.83 twelve times is 9.96.
    const credits = creditsFor(fromDays(10), FULL_YEAR);
    expect(credits.every((c) => c === 83 || c === 84)).toBe(true);
    expect(credits.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('adds up exactly for every entitlement up to a year', () => {
    for (let annual = 1; annual <= 36_600; annual += 37) {
      const total = creditsFor(dayHundredths(annual), FULL_YEAR).reduce((a, b) => a + b, 0);
      expect(total, `annual ${annual}`).toBe(annual);
    }
  });

  it('earns nothing before joining, and a full month after', () => {
    const joinedJuly: Tenure = { joinDate: istDate('2026-07-01'), exitDate: null };
    expect(creditsFor(fromDays(12), joinedJuly)).toEqual([0, 0, 0, 0, 0, 0, 100, 100, 100, 100, 100, 100]);
  });

  it('pro-rates the joining month by calendar days', () => {
    // 16 of July's 31 days: 16/31 of 1.00 is 0.516..., rounded to 0.52.
    const midJuly: Tenure = { joinDate: istDate('2026-07-16'), exitDate: null };
    const credits = creditsFor(fromDays(12), midJuly);
    expect(credits[6]).toBe(52);
    expect(credits.slice(7)).toEqual([100, 100, 100, 100, 100]);
    expect(sumDays(credits as DayHundredths[])).toBe(552);
  });

  it('stops at the exit date', () => {
    const leftMidMarch: Tenure = { joinDate: istDate('2020-01-01'), exitDate: istDate('2026-03-15') };
    const credits = creditsFor(fromDays(12), leftMidMarch);
    expect(credits.slice(0, 3)).toEqual([100, 100, 48]); // 15/31 of March
    expect(credits.slice(3).every((c) => c === 0)).toBe(true);
  });
});

describe('yearly grant', () => {
  it('grants the whole year to someone here all year', () => {
    expect(yearlyGrant(fromDays(12), YEAR, FULL_YEAR, true)).toBe(1200);
  });

  it('pro-rates a mid-year joiner by the months left', () => {
    expect(yearlyGrant(fromDays(12), YEAR, { joinDate: istDate('2026-07-01'), exitDate: null }, true)).toBe(600);
  });

  it('agrees with a year of monthly accrual about what a partial year is worth', () => {
    const tenure: Tenure = { joinDate: istDate('2026-07-16'), exitDate: null };
    const monthlyTotal = creditsFor(fromDays(12), tenure).reduce((a, b) => a + b, 0);
    expect(yearlyGrant(fromDays(12), YEAR, tenure, true)).toBe(monthlyTotal);
  });

  it('grants the full year without pro-rata, and nothing to someone not here at all', () => {
    const joinedDecember: Tenure = { joinDate: istDate('2026-12-31'), exitDate: null };
    expect(yearlyGrant(fromDays(12), YEAR, joinedDecember, false)).toBe(1200);
    expect(yearlyGrant(fromDays(12), YEAR, { joinDate: istDate('2027-01-05'), exitDate: null }, false)).toBe(0);
  });
});

describe('the shared schemas', () => {
  const type = '00000000-0000-4000-8000-000000000000';

  it('refuses a cross-year span before it reaches the server', () => {
    const result = applyLeaveSchema.safeParse({ leaveTypeId: type, startDate: '2026-12-31', endDate: '2027-01-01' });
    expect(result.success).toBe(false);
  });

  it('reports a bad date as a bad date, rather than throwing', () => {
    const result = applyLeaveSchema.safeParse({ leaveTypeId: type, startDate: '2026-02-30', endDate: '2026-03-01' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain('startDate');
  });

  it('defaults to whole days', () => {
    const parsed = applyLeaveSchema.parse({ leaveTypeId: type, startDate: '2026-11-03', endDate: '2026-11-04' });
    expect(parsed.startSession).toBe('FIRST');
    expect(parsed.endSession).toBe('SECOND');
  });

  it('will not let unpaid leave accrue', () => {
    expect(createLeaveTypeSchema.safeParse({
      code: 'lwp', name: 'Leave without pay', isPaid: false, accrualFrequency: 'MONTHLY', annualEntitlementDays: 12,
    }).success).toBe(false);
  });

  it('takes days to two decimals, and no further', () => {
    const base = { employeeId: type, leaveTypeId: type, calendarYear: 2026, kind: 'OPENING', reason: 'go-live' };
    expect(leaveAdjustmentSchema.safeParse({ ...base, days: 6.25 }).success).toBe(true);
    expect(leaveAdjustmentSchema.safeParse({ ...base, days: 6.255 }).success).toBe(false);
    expect(leaveAdjustmentSchema.safeParse({ ...base, days: 0 }).success).toBe(false);
  });

  it('ships default leave types the schema itself would accept', () => {
    for (const { annualEntitlement, ...t } of DEFAULT_LEAVE_TYPES) {
      const parsed = createLeaveTypeSchema.safeParse({ ...t, annualEntitlementDays: toDays(annualEntitlement) });
      expect(parsed.success, t.code).toBe(true);
    }
  });
});
