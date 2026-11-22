import {
  pgTable, uuid, text, boolean, date, smallint, timestamp, pgEnum, index, unique, uniqueIndex, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant';
import { employee } from './employee';

/**
 * Attendance (ATT). Three tables, all tenant-owned and under RLS.
 *
 * TIMES OF DAY ARE MINUTES PAST IST MIDNIGHT (0..1439), for the reason leave is
 * hundredths of a day: lateness and half days are arithmetic on them. See
 * packages/core/src/attendance/shift.ts. A PUNCH is an instant, stored in UTC
 * like every timestamp here, and given an attendance date only when it is read
 * — by the roster in force then — never stored with one that can go stale.
 */

/**
 * Where a punch came from (TR-10). Only WEB is written today; the rest are named
 * now so that a punch's provenance is never a guess when they arrive.
 *
 *   WEB        the ESS portal, ATT-02 — time from the server's clock
 *   MOBILE     the app, ATT-01 — geo-fenced, maybe offline and synced later
 *   BIOMETRIC  a device push, ATT-03
 *   IMPORT     a CSV from a device that cannot push, ATT-03
 */
export const punchSource = pgEnum('punch_source', ['WEB', 'MOBILE', 'BIOMETRIC', 'IMPORT']);
export const punchDirection = pgEnum('punch_direction', ['IN', 'OUT']);

/**
 * A shift (ATT-04): when someone is due at work. An end at or before the start
 * runs past midnight — that alone makes it a night shift.
 *
 * One shift per company may be the DEFAULT: it applies to anyone on a date no
 * roster entry covers. Signup seeds one (core attendance/defaults.ts).
 */
export const shift = pgTable('shift', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),

  /** What rosters and reports show. Never edited once created. */
  code: text('code').notNull(),
  name: text('name').notNull(),
  startMinute: smallint('start_minute').notNull(),
  endMinute: smallint('end_minute').notNull(),
  /** How late an arrival may be and still count as on time (ATT-06 builds on it). */
  graceMinutes: smallint('grace_minutes').notNull().default(15),

  isDefault: boolean('is_default').notNull().default(false),
  /** Inactive shifts take no new roster entries. Entries already made keep them. */
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  unique('shift_tenant_code_uq').on(t.tenantId, t.code),
  index('shift_tenant_idx').on(t.tenantId),
  // At most one default per company, whatever the service does.
  uniqueIndex('shift_tenant_default_uq').on(t.tenantId).where(sql`is_default`),
  check('shift_minutes_ck', sql`${t.startMinute} between 0 and 1439 and ${t.endMinute} between 0 and 1439`),
  // Equal times leave no gap between one day's shift and the next, and the gap
  // is what decides which day a punch belongs to (attendanceDateOf).
  check('shift_not_empty_ck', sql`${t.startMinute} <> ${t.endMinute}`),
  check('shift_grace_ck', sql`${t.graceMinutes} between 0 and 120`),
  check('shift_default_active_ck', sql`${t.isActive} or not ${t.isDefault}`),
]);

/**
 * A roster entry (ATT-04): from this date, this person works this shift with
 * these weekly offs — until their next entry starts. A timeline of changes with
 * no end dates, so entries can never overlap (core attendance/roster.ts).
 *
 * Not append-only: a roster is a plan, and a wrong one is corrected. Every
 * change is audited, and once a month is locked (ATT-09) the lock — not this
 * table — is what payroll reads.
 */
export const rosterAssignment = pgTable('roster_assignment', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employee.id, { onDelete: 'cascade' }),
  shiftId: uuid('shift_id').notNull().references(() => shift.id),

  effectiveFrom: date('effective_from').notNull(),
  /**
   * 0 = Sunday .. 6 = Saturday. Stated on every entry rather than inherited from
   * the company's setting, so that changing the office's weekly offs does not
   * quietly re-roster everyone who already has one.
   */
  weeklyOffDays: smallint('weekly_off_days').array().notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  unique('roster_assignment_employee_from_uq').on(t.employeeId, t.effectiveFrom),
  index('roster_assignment_tenant_idx').on(t.tenantId),
  index('roster_assignment_shift_idx').on(t.shiftId),
  check('roster_assignment_weekly_offs_ck', sql`cardinality(${t.weeklyOffDays}) <= 6`),
]);

/**
 * A punch (TR-10). APPEND-ONLY, like leave_txn: a punch is evidence of when
 * someone was at work, and evidence that can be edited is not evidence. A
 * missed or wrong punch is put right by a regularization request (ATT-05) on top
 * of it, never by changing it. The app role holds no UPDATE or DELETE grant, and
 * a trigger refuses both anyway (rls/policies.sql).
 *
 * No attendance date is stored: which day a punch belongs to depends on the
 * shifts either side of it (core attendanceDateOf), and a roster corrected
 * afterwards must move it.
 */
export const punchEvent = pgTable('punch_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employee.id, { onDelete: 'cascade' }),

  /** When it happened. For WEB, the server's clock at the request; never the browser's. */
  punchedAt: timestamp('punched_at', { withTimezone: true }).notNull(),
  /**
   * What the person meant: in or out. Null where a source cannot say (some
   * biometric devices). Day derivation reads first in and last out by time, not
   * by this, so a device that guesses wrong cannot move anyone's hours.
   */
  direction: punchDirection('direction'),
  source: punchSource('source').notNull(),

  /** When the server received it — later than punched_at only for a synced offline punch. */
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  index('punch_event_tenant_idx').on(t.tenantId),
  index('punch_event_employee_idx').on(t.employeeId, t.punchedAt),
]);

export type Shift = typeof shift.$inferSelect;
export type NewShift = typeof shift.$inferInsert;
export type RosterAssignment = typeof rosterAssignment.$inferSelect;
export type PunchEvent = typeof punchEvent.$inferSelect;
