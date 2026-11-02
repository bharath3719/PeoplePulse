import type { AccrualFrequency } from './accrual';
import type { DayCountBasis } from './span';
import { fromDays, type DayHundredths } from './units';

export interface LeaveTypeTemplate {
  readonly code: string;
  readonly name: string;
  readonly isPaid: boolean;
  readonly dayCountBasis: DayCountBasis;
  readonly allowsHalfDay: boolean;
  readonly accrualFrequency: AccrualFrequency;
  readonly annualEntitlement: DayHundredths;
  readonly proRataOnJoin: boolean;
}

/**
 * The leave types every new company starts with (TR-02), like the system roles.
 *
 * DEFAULTS, not law. They are common SMB policy, written into each tenant as
 * data that HR edits on day one. They are deliberately NOT presented as the
 * Karnataka Shops & Commercial Establishments Act minimums: those must come from
 * the Compliance SME (OPEN.md D-21), not from anyone's memory — the same rule
 * D-15 set for the PT slab.
 *
 * Maternity has no accrual. Nobody earns it by the month; it is granted to the
 * person it applies to, by HR, as a ledger adjustment — and counted in calendar
 * days, because the Act's 26 weeks are calendar weeks.
 */
export const DEFAULT_LEAVE_TYPES: readonly LeaveTypeTemplate[] = [
  {
    code: 'CL', name: 'Casual Leave', isPaid: true, dayCountBasis: 'WORKING_DAYS',
    allowsHalfDay: true, accrualFrequency: 'YEARLY', annualEntitlement: fromDays(12), proRataOnJoin: true,
  },
  {
    code: 'SL', name: 'Sick Leave', isPaid: true, dayCountBasis: 'WORKING_DAYS',
    allowsHalfDay: true, accrualFrequency: 'YEARLY', annualEntitlement: fromDays(12), proRataOnJoin: true,
  },
  {
    code: 'EL', name: 'Earned Leave', isPaid: true, dayCountBasis: 'WORKING_DAYS',
    allowsHalfDay: false, accrualFrequency: 'MONTHLY', annualEntitlement: fromDays(15), proRataOnJoin: true,
  },
  {
    code: 'LOP', name: 'Loss of Pay', isPaid: false, dayCountBasis: 'WORKING_DAYS',
    allowsHalfDay: true, accrualFrequency: 'NONE', annualEntitlement: fromDays(0), proRataOnJoin: false,
  },
  {
    code: 'ML', name: 'Maternity Leave', isPaid: true, dayCountBasis: 'CALENDAR_DAYS',
    allowsHalfDay: false, accrualFrequency: 'NONE', annualEntitlement: fromDays(0), proRataOnJoin: false,
  },
];
