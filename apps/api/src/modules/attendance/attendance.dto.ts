import { crossesMidnight, formatClock, shiftLengthMinutes, type PunchDirection } from '@peoplepulse/core';
import type { PunchEvent, Shift } from '@peoplepulse/db';
import type { RosterRow } from './attendance-access';

/**
 * The request schemas live in @peoplepulse/core (validation/attendance.ts),
 * shared with the web forms; re-exported here because a DTO is where a reader
 * looks for them. What stays here is the response shape.
 *
 * Times of day leave as "HH:MM" in IST — `formatClock` at this boundary and
 * nowhere before it. Punches leave as ISO instants; the browser shows them in IST.
 */
export {
  createShiftSchema, updateShiftSchema, assignRosterSchema, punchSchema, punchRangeSchema,
  type CreateShiftInput, type UpdateShiftInput, type AssignRosterInput, type PunchInput, type PunchRangeInput,
} from '@peoplepulse/core';

export interface ShiftRef {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
}

export interface ShiftView extends ShiftRef {
  graceMinutes: number;
  /** Ends the morning after it starts. Derived from the times; never stored. */
  crossesMidnight: boolean;
  lengthMinutes: number;
  isDefault: boolean;
  isActive: boolean;
}

export function toShiftRef(row: Shift): ShiftRef {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    startTime: formatClock(row.startMinute),
    endTime: formatClock(row.endMinute),
  };
}

export function toShiftView(row: Shift): ShiftView {
  return {
    ...toShiftRef(row),
    graceMinutes: row.graceMinutes,
    crossesMidnight: crossesMidnight(row),
    lengthMinutes: shiftLengthMinutes(row),
    isDefault: row.isDefault,
    isActive: row.isActive,
  };
}

export interface RosterEntryView {
  id: string;
  effectiveFrom: string;
  shift: ShiftRef;
  weeklyOffDays: number[];
}

export function toRosterEntryView(row: RosterRow): RosterEntryView {
  return { id: row.id, effectiveFrom: row.effectiveFrom, shift: toShiftRef(row.shift), weeklyOffDays: row.weeklyOffDays };
}

/** One person's roster: what applies today, and every entry, newest first. */
export interface RosterView {
  employeeId: string;
  today: string;
  current: {
    shift: ShiftRef | null;
    weeklyOffDays: number[];
    /** ROSTER: an entry covers today. COMPANY: nothing does, so the company's default shift and weekly offs apply. */
    from: 'ROSTER' | 'COMPANY';
  };
  entries: RosterEntryView[];
  /** The server's answer to "may I change this roster?" — re-checked on the change itself. */
  canManage: boolean;
}

export interface PunchView {
  id: string;
  at: string;
  direction: PunchDirection | null;
  source: PunchEvent['source'];
}

export function toPunchView(row: PunchEvent): PunchView {
  return { id: row.id, at: row.punchedAt.toISOString(), direction: row.direction, source: row.source };
}

/**
 * One attendance day: the shift it was rostered on and the punches that belong
 * to it. Raw — whether that makes the day present, late or half is day
 * derivation's to say (TR-11), from these same rows.
 */
export interface AttendanceDayView {
  date: string;
  shift: ShiftRef | null;
  weeklyOff: boolean;
  /** The holiday's name, where one falls on this day at the person's location. */
  holiday: string | null;
  punches: PunchView[];
}

/** The punch card: today's attendance day, and which button comes next. */
export interface PunchStatusView {
  today: AttendanceDayView;
  /** What the next punch would be: OUT after an IN, IN otherwise. */
  next: PunchDirection;
}
