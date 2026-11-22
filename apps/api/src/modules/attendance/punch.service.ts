import { Injectable, Inject, Optional, ConflictException } from '@nestjs/common';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { punchEvent, withTenant, type Database, type Employee, type PunchEvent, type TenantDatabase } from '@peoplepulse/db';
import {
  addDays, attendanceDateOf, istDate, toIstDate, weekdayOf,
  type Actor, type IstDate, type PunchDirection,
} from '@peoplepulse/core';
import { DB } from '../../platform/database/database.module';
import { validationFailed } from '../../platform/validation/zod.pipe';
import {
  findVisibleEmployee, holidaysBetween, ownEmployee, scheduleFor, shiftOn, shiftResolver, weeklyOffsOn,
  type Schedule,
} from './attendance-access';
import {
  toPunchView, toShiftRef,
  type AttendanceDayView, type PunchInput, type PunchRangeInput, type PunchStatusView,
} from './attendance.dto';

/**
 * What time it is. Injected so a test can stand at 06:10 the morning after a
 * night shift; in the app it is always the server's clock. Never a time from
 * the request — a time the browser could send is a time anyone could choose.
 */
export const CLOCK = Symbol('CLOCK');
export type Clock = () => Date;

/**
 * Punches (ATT-02, TR-10): punching in and out from the browser, and reading
 * them back by attendance day.
 *
 * A punch is appended and never changed. Which attendance day it belongs to is
 * worked out when it is read, from the roster in force (core attendanceDateOf),
 * so a roster corrected afterwards files it under the right day. Whether the
 * day is present, late or half is day derivation's (TR-11) — not here.
 *
 * Punches are not written to the audit log: each one already records who, when
 * and how, in a table nothing can rewrite.
 */
@Injectable()
export class PunchService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Optional() @Inject(CLOCK) private readonly clock: Clock = () => new Date(),
  ) {}

  /** The punch card: today's attendance day, and whether the next punch is IN or OUT. */
  async status(actor: Actor): Promise<PunchStatusView> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const me = await ownEmployee(tx, actor);
      return this.statusAt(tx, actor, me, this.clock());
    });
  }

  /**
   * Punch in or out, now. The direction is what the person meant: a second
   * click from a page that has not caught up is refused, not turned into the
   * opposite punch. The employee row is locked first, so two clicks sent
   * together are decided one after the other and the second sees the first.
   */
  async punch(actor: Actor, input: PunchInput): Promise<PunchStatusView> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const me = await ownEmployee(tx, actor, { lock: true });
      const now = this.clock();
      const before = await this.statusAt(tx, actor, me, now);
      const date = before.today.date;

      if (date < me.joinDate) {
        throw validationFailed([{ field: 'direction', message: `You join on ${me.joinDate} — punching starts then` }]);
      }
      if (me.exitDate && date > me.exitDate) {
        throw validationFailed([{ field: 'direction', message: `Your last working day was ${me.exitDate}` }]);
      }
      if (input.direction !== before.next) {
        throw new ConflictException(input.direction === 'IN'
          ? { code: 'ALREADY_PUNCHED_IN', message: 'You are already punched in. Punch out first.' }
          : { code: 'NOT_PUNCHED_IN', message: 'You are not punched in, so there is nothing to punch out of.' });
      }

      const [created] = await tx.insert(punchEvent).values({
        tenantId: actor.tenantId,
        employeeId: me.id,
        punchedAt: now,
        direction: input.direction,
        source: 'WEB',
        createdBy: actor.userId,
      }).returning();

      return {
        today: { ...before.today, punches: [...before.today.punches, toPunchView(created!)] },
        next: input.direction === 'IN' ? 'OUT' : 'IN',
      };
    });
  }

  /** Attendance days `from`..`to`, newest first, each with its shift and the punches filed under it. */
  async days(actor: Actor, employeeId: string, range: PunchRangeInput): Promise<AttendanceDayView[]> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const subject = await findVisibleEmployee(tx, actor, employeeId);
      const from = istDate(range.from);
      const to = istDate(range.to);

      const views = await this.dayViews(tx, actor, subject, from, to);
      return [...views.values()].reverse();
    });
  }

  private async statusAt(tx: TenantDatabase, actor: Actor, me: Employee, now: Date): Promise<PunchStatusView> {
    // Yesterday's shift decides whether an early-morning punch is still
    // yesterday's, so the schedule has to reach back a day before "today".
    const schedule = await scheduleFor(tx, actor.tenantId, me.id, toIstDate(now));
    const date = attendanceDateOf(now, shiftResolver(schedule));
    const today = (await this.dayViews(tx, actor, me, date, date, schedule)).get(date)!;
    const last = today.punches.at(-1);
    return { today, next: last?.direction === 'IN' ? 'OUT' : 'IN' };
  }

  /**
   * Every attendance day in a range, oldest first, keyed by date. A punch filed
   * under a date happens between that date's midnight and the second midnight
   * after it (the tail of a night shift), so that is the window read.
   */
  private async dayViews(
    tx: TenantDatabase, actor: Actor, subject: Employee, from: IstDate, to: IstDate, known?: Schedule,
  ): Promise<Map<string, AttendanceDayView>> {
    const schedule = known ?? await scheduleFor(tx, actor.tenantId, subject.id, addDays(to, 1));
    const holidays = await holidaysBetween(tx, subject.locationId, from, to);
    const punches = await this.punchesBetween(tx, subject.id, istMidnight(from), istMidnight(addDays(to, 2)));

    const days = new Map<string, AttendanceDayView>();
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const rostered = shiftOn(schedule, date);
      days.set(date, {
        date,
        shift: rostered ? toShiftRef(rostered) : null,
        weeklyOff: weeklyOffsOn(schedule, date).includes(weekdayOf(date)),
        holiday: holidays.get(date) ?? null,
        punches: [],
      });
    }

    const resolve = shiftResolver(schedule);
    for (const punch of punches) days.get(attendanceDateOf(punch.punchedAt, resolve))?.punches.push(toPunchView(punch));
    return days;
  }

  private punchesBetween(tx: TenantDatabase, employeeId: string, from: Date, before: Date): Promise<PunchEvent[]> {
    return tx.select().from(punchEvent)
      .where(and(eq(punchEvent.employeeId, employeeId), gte(punchEvent.punchedAt, from), lt(punchEvent.punchedAt, before)))
      .orderBy(asc(punchEvent.punchedAt), asc(punchEvent.createdAt));
  }
}

/** The instant an IST date begins. */
function istMidnight(date: IstDate): Date {
  return new Date(`${date}T00:00:00+05:30`);
}
