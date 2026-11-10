import { NO_DAYS, LeaveUnitError, dayHundredths, type DayHundredths } from './units';

/**
 * What happens to a leave balance when its calendar year ends (LVE-02, OPEN.md
 * D-25). Balances are per calendar year (D-17), so without this every balance —
 * earned leave included — would start the new year at zero.
 *
 * Each paid leave type carries two rules, as data HR edits:
 *
 *   carryForwardMax  the most of the closing balance that moves into the new
 *                    year. 0 carries nothing; null has no limit.
 *   encashMax        of what does not carry, the most set aside to be paid out.
 *
 * Whatever is left after both lapses.
 *
 * CARRY FIRST, THEN ENCASH. A policy that offers both reads "keep up to N days,
 * and we buy back up to M of the rest" — keeping leave as leave is the default,
 * and encashment is what happens to the excess. Encashing first would turn days
 * the person could have kept into taxable pay they did not ask for.
 */
export interface YearEndRule {
  readonly carryForwardMax: DayHundredths | null;
  readonly encashMax: DayHundredths;
}

/** How one closing balance divides. Each part is zero or more; together they are the whole balance. */
export interface YearEndSplit {
  readonly carry: DayHundredths;
  readonly encash: DayHundredths;
  readonly lapse: DayHundredths;
}

/** What earlier closes of the same year already moved out, as positive quantities. */
export interface YearEndAlreadyMoved {
  readonly carried: DayHundredths;
  readonly encashed: DayHundredths;
}

const NOTHING_MOVED: YearEndAlreadyMoved = { carried: NO_DAYS, encashed: NO_DAYS };
const NOTHING: YearEndSplit = { carry: NO_DAYS, encash: NO_DAYS, lapse: NO_DAYS };

/**
 * Split what is left of a year's balance.
 *
 * `remaining` is the year's ledger sum NOW — after any earlier close of the same
 * year. A year can be closed again: leave cancelled after the close gives its
 * days back to the old year, and the next close sweeps them. The limits apply
 * to the year as a whole, so `already` says what earlier closes moved and only
 * the room left under each limit is used. Closing twice with nothing new in
 * between moves nothing, because `remaining` is then zero.
 *
 * A balance of zero or less splits into nothing. A deficit is not carried into
 * the new year: someone who has taken more than they had is a question for HR
 * (recover it, forgive it, or dock it as LOP), not something to settle silently.
 */
export function yearEndSplit(
  remaining: DayHundredths,
  rule: YearEndRule,
  already: YearEndAlreadyMoved = NOTHING_MOVED,
): YearEndSplit {
  if (already.carried < 0 || already.encashed < 0) {
    throw new LeaveUnitError(`already-moved quantities are positive, got ${already.carried} / ${already.encashed}`);
  }
  if (remaining <= 0) return NOTHING;

  const carryRoom = rule.carryForwardMax === null
    ? remaining
    : Math.max(0, rule.carryForwardMax - already.carried);
  const carry = Math.min(remaining, carryRoom);

  const encashRoom = Math.max(0, rule.encashMax - already.encashed);
  const encash = Math.min(remaining - carry, encashRoom);

  return {
    carry: dayHundredths(carry),
    encash: dayHundredths(encash),
    lapse: dayHundredths(remaining - carry - encash),
  };
}
