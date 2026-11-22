import type { IstDate } from '../date/india';

/**
 * Rosters (ATT-04): who works which shift, with which weekly offs, from when.
 *
 * A roster is a timeline of CHANGES, each with only a start date. The entry
 * that applies on a date is the latest one starting on or before it, and it
 * applies until the next one starts. There are no end dates, so two entries can
 * never overlap and there is never a gap to fall into once the first exists.
 *
 *   from 1 Jan   General, Sunday off
 *   from 3 Mar   Night,   Sunday off      <- 3 Mar onward, until ...
 *   from 6 Apr   General, Sat + Sun off
 *
 * A rotation is a series of these — one per week, entered ahead. Before the
 * first entry, and for anyone with none, the company default applies: its
 * default shift and its weekly offs.
 */
export interface RosterEntry {
  readonly effectiveFrom: string;
  /** 0 = Sunday .. 6 = Saturday. */
  readonly weeklyOffDays: readonly number[];
}

/**
 * The entry in force on a date, or null before the first. `entries` may be in
 * any order; it is a handful of rows per person.
 */
export function rosterOn<T extends RosterEntry>(entries: readonly T[], date: IstDate | string): T | null {
  let found: T | null = null;
  for (const entry of entries) {
    if (entry.effectiveFrom <= date && (!found || entry.effectiveFrom > found.effectiveFrom)) found = entry;
  }
  return found;
}
