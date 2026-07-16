import { describe, it, expect } from 'vitest';
import {
  istDate, toIstDate, financialYearOf, financialYearStart, financialYearEnd,
  leaveYearOf, esiContributionPeriodOf, esiContributionPeriodStart,
  payrollMonth, daysInMonth, attendanceDayOf, addDays, daysBetweenInclusive,
  DateError,
} from './india';

describe('IST', () => {
  it('resolves the IST calendar day of an instant', () => {
    // 19:30 UTC is 01:00 IST the NEXT day. A punch here belongs to the 14th.
    expect(toIstDate(new Date('2026-07-13T19:30:00Z'))).toBe('2026-07-14');
    expect(toIstDate(new Date('2026-07-13T18:29:00Z'))).toBe('2026-07-13');
  });

  it('rejects dates that do not exist', () => {
    expect(() => istDate('2026-02-30')).toThrow(DateError);
    expect(() => istDate('13-07-2026')).toThrow(DateError);
  });
});

describe('financial year vs leave year — deliberately different (D-17)', () => {
  it('runs the financial year April to March', () => {
    expect(financialYearOf(istDate('2026-07-13'))).toBe('2026-27');
    expect(financialYearOf(istDate('2026-04-01'))).toBe('2026-27');
    expect(financialYearOf(istDate('2027-03-31'))).toBe('2026-27');
  });

  it('puts January in the financial year that started LAST April', () => {
    // The trap: Jan 2027 is FY 2026-27, not 2027-28.
    expect(financialYearOf(istDate('2027-01-15'))).toBe('2026-27');
    expect(financialYearOf(istDate('2027-04-01'))).toBe('2027-28');
  });

  it('runs the leave year January to December', () => {
    expect(leaveYearOf(istDate('2026-01-01'))).toBe(2026);
    expect(leaveYearOf(istDate('2026-12-31'))).toBe(2026);
  });

  it('gives the SAME date two different years — which is the whole point', () => {
    const d = istDate('2027-02-10');
    expect(financialYearOf(d)).toBe('2026-27'); // tax
    expect(leaveYearOf(d)).toBe(2027);          // leave
  });

  it('bounds the financial year', () => {
    expect(financialYearStart(financialYearOf(istDate('2026-07-13')))).toBe('2026-04-01');
    expect(financialYearEnd(financialYearOf(istDate('2026-07-13')))).toBe('2027-03-31');
  });
});

describe('ESI contribution periods', () => {
  it('splits the year April-September and October-March', () => {
    expect(esiContributionPeriodOf(istDate('2026-04-01'))).toBe('APR_SEP');
    expect(esiContributionPeriodOf(istDate('2026-09-30'))).toBe('APR_SEP');
    expect(esiContributionPeriodOf(istDate('2026-10-01'))).toBe('OCT_MAR');
    expect(esiContributionPeriodOf(istDate('2027-03-31'))).toBe('OCT_MAR');
  });

  it('anchors a January date to the October that started its period', () => {
    // Coverage is fixed at the period start, so we must be able to find it.
    expect(esiContributionPeriodStart(istDate('2027-02-15'))).toBe('2026-10-01');
    expect(esiContributionPeriodStart(istDate('2026-11-20'))).toBe('2026-10-01');
    expect(esiContributionPeriodStart(istDate('2026-07-13'))).toBe('2026-04-01');
  });
});

describe('payroll months', () => {
  it('knows real month lengths, because pro-rata divides by them', () => {
    expect(daysInMonth(payrollMonth('2026-02'))).toBe(28);
    expect(daysInMonth(payrollMonth('2028-02'))).toBe(29); // leap
    expect(daysInMonth(payrollMonth('2026-07'))).toBe(31);
    expect(daysInMonth(payrollMonth('2026-06'))).toBe(30);
  });

  it('rejects a malformed month', () => {
    expect(() => payrollMonth('2026-13')).toThrow(DateError);
    expect(() => payrollMonth('2026-7')).toThrow(DateError);
  });
});

describe('night-shift attendance day (D-17) — one shift, one day', () => {
  const nightShift = { isNight: true, cutoverHour: 12 };
  const dayShift = { isNight: false, cutoverHour: 0 };

  it('files a day-shift punch under the day it happened', () => {
    // 09:30 IST on the 13th = 04:00 UTC.
    expect(attendanceDayOf(new Date('2026-07-13T04:00:00Z'), dayShift)).toBe('2026-07-13');
  });

  it('files BOTH ends of a night shift under the day the shift STARTED', () => {
    // Punch IN  22:00 IST on the 13th  (= 16:30 UTC on the 13th)
    const punchIn = new Date('2026-07-13T16:30:00Z');
    // Punch OUT 06:00 IST on the 14th  (= 00:30 UTC on the 14th)
    const punchOut = new Date('2026-07-14T00:30:00Z');

    // Naively, these fall on different IST dates:
    expect(toIstDate(punchIn)).toBe('2026-07-13');
    expect(toIstDate(punchOut)).toBe('2026-07-14');

    // But for a night shift they are ONE attendance day — the 13th.
    // Without this, both days flag a missing punch and LOP is wrong twice.
    expect(attendanceDayOf(punchIn, nightShift)).toBe('2026-07-13');
    expect(attendanceDayOf(punchOut, nightShift)).toBe('2026-07-13');
  });

  it('files a night-shift punch after the cutover under the new day', () => {
    // 14:00 IST — past noon, so this is the START of tonight's shift, not the
    // tail of last night's.
    expect(attendanceDayOf(new Date('2026-07-14T08:30:00Z'), nightShift)).toBe('2026-07-14');
  });
});

describe('day arithmetic', () => {
  it('counts inclusively — a one-day leave is 1 day, not 0', () => {
    expect(daysBetweenInclusive(istDate('2026-07-13'), istDate('2026-07-13'))).toBe(1);
    expect(daysBetweenInclusive(istDate('2026-07-13'), istDate('2026-07-17'))).toBe(5);
  });

  it('crosses month and year boundaries', () => {
    expect(addDays(istDate('2026-07-31'), 1)).toBe('2026-08-01');
    expect(addDays(istDate('2026-01-01'), -1)).toBe('2025-12-31');
    expect(addDays(istDate('2028-02-28'), 1)).toBe('2028-02-29'); // leap
  });
});
