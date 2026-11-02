import {
  pgTable, uuid, text, boolean, date, integer, timestamp, pgEnum, index, unique, uniqueIndex, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant';
import { location } from './org';
import { employee } from './employee';

/**
 * Leave (LVE). Four tables, all tenant-owned and under RLS.
 *
 * QUANTITIES ARE INTEGER HUNDREDTHS OF A DAY — 150 is a day and a half — for
 * the reason money is integer paise: a balance is a sum, and leave becomes
 * money as LOP and as encashment. See packages/core/src/leave/units.ts.
 *
 * YEARS ARE CALENDAR YEARS (D-17), and the column says so: `calendar_year`,
 * never `year`, because the financial year is in this schema too.
 */

export const leaveDayCountBasis = pgEnum('leave_day_count_basis', ['WORKING_DAYS', 'CALENDAR_DAYS']);
export const leaveAccrualFrequency = pgEnum('leave_accrual_frequency', ['NONE', 'MONTHLY', 'YEARLY']);
export const leaveSession = pgEnum('leave_session', ['FIRST', 'SECOND']);
export const leaveRequestStatus = pgEnum('leave_request_status', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);

/**
 * Every way a balance moves (TR-15).
 *
 *   OPENING     carried in from before PeoplePulse, at go-live (LVE-08)
 *   GRANT       a YEARLY policy's grant for the year
 *   ACCRUAL     a MONTHLY policy's credit for one month
 *   ADJUSTMENT  a correction by HR, with its reason
 *   DEBIT       approved leave, taken off
 *   REVERSAL    approved leave cancelled, given back
 */
export const leaveTxnKind = pgEnum('leave_txn_kind', [
  'OPENING', 'GRANT', 'ACCRUAL', 'ADJUSTMENT', 'DEBIT', 'REVERSAL',
]);

/** A kind of leave a company offers (LVE-01). Seeded at signup from DEFAULT_LEAVE_TYPES. */
export const leaveType = pgTable('leave_type', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),

  /** What payroll and reports match on. Never edited once created. */
  code: text('code').notNull(),
  name: text('name').notNull(),

  /**
   * Unpaid leave (LOP) has no balance and no ledger: there is nothing to run
   * out of. Payroll reads its approved requests as loss-of-pay days. Never
   * changed after creation — it would strand every balance already earned.
   */
  isPaid: boolean('is_paid').notNull().default(true),
  dayCountBasis: leaveDayCountBasis('day_count_basis').notNull().default('WORKING_DAYS'),
  allowsHalfDay: boolean('allows_half_day').notNull().default(true),

  accrualFrequency: leaveAccrualFrequency('accrual_frequency').notNull().default('NONE'),
  annualEntitlementHundredths: integer('annual_entitlement_hundredths').notNull().default(0),
  proRataOnJoin: boolean('pro_rata_on_join').notNull().default(true),

  /** Inactive types take no new requests. Their history, and any balance, stays. */
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  unique('leave_type_tenant_code_uq').on(t.tenantId, t.code),
  index('leave_type_tenant_idx').on(t.tenantId),
  check('leave_type_entitlement_ck', sql`${t.annualEntitlementHundredths} between 0 and 36600`),
  check('leave_type_unpaid_no_accrual_ck', sql`${t.isPaid} or ${t.accrualFrequency} = 'NONE'`),
]);

/**
 * A holiday (LVE-04). With no location it applies at every location.
 *
 * Optional / restricted holidays, where each employee picks some of a list, are
 * not modelled yet (OPEN.md D-22). Every row here is a day off for everyone it
 * applies to.
 */
export const holiday = pgTable('holiday', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').references(() => location.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  // NULLS NOT DISTINCT, or two company-wide holidays on one date would both fit:
  // NULL location ids are otherwise never equal to each other.
  unique('holiday_tenant_location_date_uq').on(t.tenantId, t.locationId, t.date).nullsNotDistinct(),
  index('holiday_tenant_date_idx').on(t.tenantId, t.date),
]);

/**
 * A request for leave (LVE-03, LVE-05), from one half-day session to another.
 *
 * `days_hundredths` is counted when the request is made — against the weekly
 * offs and holidays as they stood then — and is what approval debits. A holiday
 * declared afterwards does not re-price it (OPEN.md D-23).
 */
export const leaveRequest = pgTable('leave_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employee.id, { onDelete: 'cascade' }),
  leaveTypeId: uuid('leave_type_id').notNull().references(() => leaveType.id),

  startDate: date('start_date').notNull(),
  startSession: leaveSession('start_session').notNull(),
  endDate: date('end_date').notNull(),
  endSession: leaveSession('end_session').notNull(),
  daysHundredths: integer('days_hundredths').notNull(),
  reason: text('reason'),

  status: leaveRequestStatus('status').notNull().default('PENDING'),
  decidedByUserId: uuid('decided_by_user_id'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  index('leave_request_tenant_idx').on(t.tenantId),
  index('leave_request_employee_idx').on(t.employeeId, t.startDate),
  index('leave_request_tenant_status_idx').on(t.tenantId, t.status),
  check('leave_request_dates_ck', sql`${t.endDate} >= ${t.startDate}`),
  check('leave_request_days_ck', sql`${t.daysHundredths} > 0`),
]);

/**
 * The leave ledger (TR-15). APPEND-ONLY, like employee_event.
 *
 * A balance is never stored and never edited. It is the SUM of this table for
 * one employee, leave type and calendar year — so "why do I have 4.5 days?" is
 * always answerable, line by line. A wrong entry is corrected by another entry.
 * The app role holds no UPDATE or DELETE grant here, and a trigger refuses both
 * anyway (rls/policies.sql).
 */
export const leaveTxn = pgTable('leave_txn', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employee.id, { onDelete: 'cascade' }),
  leaveTypeId: uuid('leave_type_id').notNull().references(() => leaveType.id),

  calendarYear: integer('calendar_year').notNull(),
  kind: leaveTxnKind('kind').notNull(),
  /** Signed. Credits are positive, DEBIT is negative. */
  daysHundredths: integer('days_hundredths').notNull(),

  /** For DEBIT and REVERSAL: the request taken or given back. */
  leaveRequestId: uuid('leave_request_id').references(() => leaveRequest.id, { onDelete: 'cascade' }),
  /** For ACCRUAL ('2026-11') and GRANT ('2026'): the period it is for. */
  accrualPeriod: text('accrual_period'),
  reason: text('reason'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  index('leave_txn_tenant_idx').on(t.tenantId),
  index('leave_txn_balance_idx').on(t.employeeId, t.leaveTypeId, t.calendarYear),

  // Posting accruals twice must post them once. The run inserts with ON
  // CONFLICT DO NOTHING against this, so re-running a month is harmless.
  uniqueIndex('leave_txn_accrual_uq').on(t.employeeId, t.leaveTypeId, t.accrualPeriod)
    .where(sql`accrual_period is not null`),

  // A request is debited at most once and given back at most once, whatever
  // the service does — two approvers clicking together cannot take it twice.
  uniqueIndex('leave_txn_request_uq').on(t.leaveRequestId, t.kind)
    .where(sql`leave_request_id is not null`),

  check('leave_txn_nonzero_ck', sql`${t.daysHundredths} <> 0`),
  check('leave_txn_sign_ck', sql`
    (${t.kind} = 'DEBIT' and ${t.daysHundredths} < 0)
    or (${t.kind} in ('GRANT', 'ACCRUAL', 'REVERSAL') and ${t.daysHundredths} > 0)
    or ${t.kind} in ('OPENING', 'ADJUSTMENT')
  `),
]);

export type LeaveType = typeof leaveType.$inferSelect;
export type NewLeaveType = typeof leaveType.$inferInsert;
export type Holiday = typeof holiday.$inferSelect;
export type LeaveRequest = typeof leaveRequest.$inferSelect;
export type LeaveTxn = typeof leaveTxn.$inferSelect;
