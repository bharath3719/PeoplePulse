import { dayHundredths, toDays, type Session } from '@peoplepulse/core';
import type { Holiday, LeaveType } from '@peoplepulse/db';

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
  leaveAdjustmentSchema, postAccrualsSchema,
  type PreviewLeaveInput, type ApplyLeaveInput, type LeaveDecisionInput,
  type CreateLeaveTypeInput, type UpdateLeaveTypeInput, type CreateHolidayInput, type LeaveSettingsInput,
  type LeaveAdjustmentInput, type PostAccrualsInput,
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

export interface LeaveLedgerEntryView {
  id: string;
  leaveType: { id: string; code: string; name: string };
  kind: 'OPENING' | 'GRANT' | 'ACCRUAL' | 'ADJUSTMENT' | 'DEBIT' | 'REVERSAL';
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
