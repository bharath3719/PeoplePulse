import { dayHundredths, toDays, type Session } from '@peoplepulse/core';
import type { Holiday, LeaveTxn, LeaveType } from '@peoplepulse/db';

type LeaveTxnKind = LeaveTxn['kind'];

/**
 * The request schemas live in @peoplepulse/core (validation/leave.ts), shared
 * with the web form; they are re-exported here because a DTO is where a reader
 * looks for them. What stays here is the response shape.
 *
 * Quantities leave in DAYS, the way money leaves in rupees — `toDays` at this
 * boundary and nowhere before it.
 */
export {
  previewLeaveSchema, applyLeaveSchema, leaveDecisionSchema,
  createLeaveTypeSchema, updateLeaveTypeSchema, createHolidaySchema, leaveSettingsSchema,
  leaveAdjustmentSchema, postAccrualsSchema, leaveYearEndSchema,
  type PreviewLeaveInput, type ApplyLeaveInput, type LeaveDecisionInput,
  type CreateLeaveTypeInput, type UpdateLeaveTypeInput, type CreateHolidayInput, type LeaveSettingsInput,
  type LeaveAdjustmentInput, type PostAccrualsInput, type LeaveYearEndInput,
} from '@peoplepulse/core';

export interface LeaveTypeView {
  id: string;
  code: string;
  name: string;
  isPaid: boolean;
  dayCountBasis: LeaveType['dayCountBasis'];
  allowsHalfDay: boolean;
  accrualFrequency: LeaveType['accrualFrequency'];
  annualEntitlementDays: number;
  proRataOnJoin: boolean;
  /** Year end: the most that carries into the next year. Null: no limit. */
  carryForwardMaxDays: number | null;
  /** Year end: of what does not carry, the most set aside to be paid out. */
  encashMaxDays: number;
  isActive: boolean;
}

export function toLeaveTypeView(row: LeaveType): LeaveTypeView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isPaid: row.isPaid,
    dayCountBasis: row.dayCountBasis,
    allowsHalfDay: row.allowsHalfDay,
    accrualFrequency: row.accrualFrequency,
    annualEntitlementDays: days(row.annualEntitlementHundredths),
    proRataOnJoin: row.proRataOnJoin,
    carryForwardMaxDays: row.carryForwardMaxHundredths === null ? null : days(row.carryForwardMaxHundredths),
    encashMaxDays: days(row.encashMaxHundredths),
    isActive: row.isActive,
  };
}

export interface HolidayView {
  id: string;
  date: string;
  name: string;
  locationId: string | null;
  locationName: string | null;
}

export function toHolidayView(row: Holiday, locationName: string | null): HolidayView {
  return { id: row.id, date: row.date, name: row.name, locationId: row.locationId, locationName };
}

export interface LeaveRequestView {
  id: string;
  employee: { id: string; empCode: string; name: string };
  leaveType: { id: string; code: string; name: string };
  startDate: string;
  startSession: Session;
  endDate: string;
  endSession: Session;
  days: number;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  /** The server's answer to "may I approve or reject this?" — re-checked on the decision itself. */
  canDecide: boolean;
  /** The server's answer to "may I cancel this?" — re-checked on the cancel itself. */
  canCancel: boolean;
}

/** What a request would cost, asked while the form is filled in. */
export interface LeavePreview {
  days: number;
  isPaid: boolean;
  /** Null for unpaid leave, which has no balance. */
  balanceDays: number | null;
  pendingDays: number | null;
  availableAfterDays: number | null;
}

export interface LeaveBalanceView {
  leaveType: { id: string; code: string; name: string; isPaid: boolean };
  calendarYear: number;
  /** The ledger's sum. Null for unpaid leave. */
  balanceDays: number | null;
  /** Requested and waiting for a decision. */
  pendingDays: number;
  /** Balance less pending: what a new request can draw on. Null for unpaid leave. */
  availableDays: number | null;
  /** Approved this year. For unpaid leave, the LOP payroll will read. */
  takenDays: number;
}

/**
 * Why a balance was left where it was at year end, for HR to resolve:
 *
 *   PENDING_REQUESTS  leave in the year still waits for a decision
 *   OVERDRAWN         the balance is below zero — recover, forgive or dock it
 *   EXITED            they left during the year; full-and-final settles it
 */
export type YearEndSkipReason = 'PENDING_REQUESTS' | 'OVERDRAWN' | 'EXITED';

/** What closing a leave year did — or, for a preview, would do. */
export interface LeaveYearEndView {
  year: number;
  /** False while the year is still running: a preview then shows the close as if it ended today, every remaining credit posted. */
  yearEnded: boolean;
  /** True for a preview: nothing was written. */
  dryRun: boolean;
  /** Missing accruals and grants for the year, posted first. */
  creditsPosted: number;
  /** People whose balances moved. */
  people: number;
  types: {
    leaveType: { id: string; code: string; name: string };
    carryForwardMaxDays: number | null;
    encashMaxDays: number;
    people: number;
    carriedDays: number;
    encashedDays: number;
    lapsedDays: number;
  }[];
  skipped: {
    employee: { id: string; empCode: string; name: string };
    leaveType: { id: string; code: string; name: string };
    reason: YearEndSkipReason;
    balanceDays: number;
    pendingDays: number;
  }[];
}

export interface LeaveLedgerEntryView {
  id: string;
  leaveType: { id: string; code: string; name: string };
  kind: LeaveTxnKind;
  days: number;
  accrualPeriod: string | null;
  reason: string | null;
  request: { id: string; startDate: string; endDate: string } | null;
  createdAt: string;
}

/** Hundredths from a row -> days on the wire. */
export function days(hundredths: number): number {
  return toDays(dayHundredths(hundredths));
}
