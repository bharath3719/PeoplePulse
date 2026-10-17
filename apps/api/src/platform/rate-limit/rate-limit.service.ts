import { Injectable, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';
import { rateLimit, withoutTenantIsolation, type Database } from '@peoplepulse/db';
import { DB } from '../database/database.module';

export interface Limit {
  limit: number;
  windowSeconds: number;
  /** Said to whoever hits it. */
  message: string;
}

/**
 * Every limit, in one place (TR-40). Fixed windows: simple, and a burst at a
 * window's edge can reach twice a limit, which none of these mind.
 */
export const LIMITS = {
  /** A company signs up once. A script signs up hundreds — each a sender of invitation emails. */
  signup: {
    limit: 5, windowSeconds: 60 * 60,
    message: 'Too many companies have been set up from here recently. Try again later.',
  },
  /**
   * Sign-in attempts from one address, right or wrong. Generous: a whole office
   * shares one address behind its router.
   */
  signInFromAddress: {
    limit: 50, windowSeconds: 15 * 60,
    message: 'Too many sign-in attempts from here. Try again in a few minutes.',
  },
  /**
   * Wrong passwords for one login, from anywhere: the guesser's budget. Counted
   * for addresses with no login too, so the answer never says which exist.
   * The real user can be locked out for the rest of the window by someone else's
   * guessing — a nuisance, against the alternative of unlimited guesses.
   */
  wrongPasswords: {
    limit: 10, windowSeconds: 15 * 60,
    message: 'Too many wrong passwords for this account. Try again in 15 minutes.',
  },
  /** Enough to invite the top of our segment (200 people) in one go. */
  invitationsPerCompany: {
    limit: 200, windowSeconds: 24 * 60 * 60,
    message: 'This company has sent as many invitations as it can today. Try again tomorrow.',
  },
  /** A re-send or two, not a barrage at one inbox. */
  invitationsPerAddress: {
    limit: 3, windowSeconds: 24 * 60 * 60,
    message: 'This address has been invited three times today. Try again tomorrow.',
  },
} as const satisfies Record<string, Limit>;

export type Bucket = keyof typeof LIMITS;

/** Counts older than this are deleted: no window is longer, and the keys are personal data. */
const RETAIN_MS = 24 * 60 * 60 * 1000;
/** Old counts are swept on every this-many hits, by whichever instance makes them. */
const SWEEP_EVERY = 500;

/**
 * Rate limits, counted in Postgres (see `rateLimit` for why not Redis, yet).
 *
 * Two operations, because sign-in needs both: `check` before verifying a
 * password, so a locked account costs no Argon2 time, and `consume` only when
 * the password was wrong.
 */
@Injectable()
export class RateLimitService {
  private hits = 0;

  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Count one hit against `key`, and refuse it — 429 — if that takes the key
   * over the limit. One atomic upsert, so concurrent hits are each counted.
   */
  async consume(bucket: Bucket, key: string): Promise<void> {
    const { limit, windowSeconds } = LIMITS[bucket];
    const windowStart = windowStartOf(windowSeconds);

    const [row] = await withoutTenantIsolation(this.db, 'rate limits: counted before any company is known', (db) =>
      db.insert(rateLimit).values({ bucket, key, windowStart, hits: 1 })
        .onConflictDoUpdate({
          target: [rateLimit.bucket, rateLimit.key, rateLimit.windowStart],
          set: { hits: sql`${rateLimit.hits} + 1` },
        })
        .returning({ hits: rateLimit.hits }));

    if (++this.hits % SWEEP_EVERY === 0) await this.sweep();
    if (row!.hits > limit) throw tooMany(bucket);
  }

  /** Refuse — 429 — if `key` has already used its limit. Counts nothing. */
  async check(bucket: Bucket, key: string): Promise<void> {
    const { limit, windowSeconds } = LIMITS[bucket];
    const [row] = await withoutTenantIsolation(this.db, 'rate limits: counted before any company is known', (db) =>
      db.select({ hits: rateLimit.hits }).from(rateLimit)
        .where(and(
          eq(rateLimit.bucket, bucket),
          eq(rateLimit.key, key),
          eq(rateLimit.windowStart, windowStartOf(windowSeconds)),
        )));
    if (row && row.hits >= limit) throw tooMany(bucket);
  }

  private async sweep(): Promise<void> {
    await withoutTenantIsolation(this.db, 'rate limits: deleting expired counts', (db) =>
      db.delete(rateLimit).where(lt(rateLimit.windowStart, new Date(Date.now() - RETAIN_MS))));
  }
}

function windowStartOf(windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(Date.now() / ms) * ms);
}

function tooMany(bucket: Bucket): HttpException {
  return new HttpException({ code: 'RATE_LIMITED', message: LIMITS[bucket].message }, HttpStatus.TOO_MANY_REQUESTS);
}
