import type { AccrualFrequency } from './accrual';
import type { DayCountBasis } from './span';
import { NO_DAYS, fromDays, type DayHundredths } from './units';

export interface LeaveTypeTemplate {
  readonly code: string;
  readonly name: string;
  readonly isPaid: boolean;
  readonly dayCountBasis: DayCountBasis;
  readonly allowsHalfDay: boolean;
  readonly accrualFrequency: AccrualFrequency;
  readonly annualEntitlement: DayHundredths;
  readonly proRataOnJoin: boolean;
  /** Year end (year-end.ts): the most that carries into the next year; null for no limit. */
  readonly carryForwardMax: DayHundredths | null;
  /** Year end: of what does not carry, the most set aside to be paid out. */
  readonly encashMax: DayHundredths;
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
 *
 * At year end (D-25) casual and sick leave lapse; earned leave and maternity
 * carry in full. Carrying everything is the safe default while the SME has not
 * named the Act's accumulation limit for earned leave (D-21): a limit the
 * company chooses is lawful, and lapsing earned leave the Act protects is not.
 * Maternity carries because 26 weeks granted in November run into January, and
 * a request cannot cross the new year.
 */
export const DEFAULT_LEAVE_TYPES: readonly LeaveTypeTemplate[] = [
  {
    code: 'CL', name: 'Casual Leave', isPaid: true, dayCountBasis: 'WORKING_DAYS',
    allowsHalfDay: true, accrualFrequency: 'YEARLY', annualEntitlement: fromDays(12), proRataOnJoin: true,
    carryForwardMax: NO_DAYS, encashMax: NO_DAYS,
  },
  {
    code: 'SL', name: 'Sick Leave', isPaid: true, dayCountBasis: 'WORKING_DAYS',
    allowsHalfDay: true, accrualFrequency: 'YEARLY', annualEntitlement: fromDays(12), proRataOnJoin: true,
    carryForwardMax: NO_DAYS, encashMax: NO_DAYS,
  },
  {
    code: 'EL', name: 'Earned Leave', isPaid: true, dayCountBasis: 'WORKING_DAYS',
    allowsHalfDay: false, accrualFrequency: 'MONTHLY', annualEntitlement: fromDays(15), proRataOnJoin: true,
    carryForwardMax: null, encashMax: NO_DAYS,
  },
  {
    code: 'LOP', name: 'Loss of Pay', isPaid: false, dayCountBasis: 'WORKING_DAYS',
    allowsHalfDay: true, accrualFrequency: 'NONE', annualEntitlement: fromDays(0), proRataOnJoin: false,
    carryForwardMax: NO_DAYS, encashMax: NO_DAYS,
  },
  {
    code: 'ML', name: 'Maternity Leave', isPaid: true, dayCountBasis: 'CALENDAR_DAYS',
    allowsHalfDay: false, accrualFrequency: 'NONE', annualEntitlement: fromDays(0), proRataOnJoin: false,
    carryForwardMax: null, encashMax: NO_DAYS,
  },
];
