import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { like } from 'drizzle-orm';
import { getDb, closeDb, assertRlsEnforced, rateLimit, type Database } from '@peoplepulse/db';
import { LIMITS, RateLimitService } from './rate-limit.service';

/**
 * The counters behind every rate limit (TR-40), against a real database —
 * because what matters is the upsert under concurrency, which a fake would
 * get right by construction.
 */
const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const OPTED_OUT = process.env['SKIP_DB_TESTS'] === '1';

if (!OPTED_OUT && !TEST_DB_URL) {
  throw new Error(
    'The rate-limit suite cannot reach a database. Set TEST_DATABASE_URL ' +
      '(see .env.example), or SKIP_DB_TESTS=1 if you mean to run without one.',
  );
}

const describeIfDb = OPTED_OUT ? describe.skip : describe;

const RUN = `test-${randomUUID().slice(0, 8)}`;
const BUCKET = 'invitationsPerAddress' as const; // a limit of 3 keeps these short
const LIMIT = LIMITS[BUCKET].limit;

let db: Database;
let limits: RateLimitService;

function key(name: string): string {
  return `${RUN}:${name}`;
}

async function status(attempt: Promise<unknown>): Promise<number> {
  return attempt.then(() => 200, (e: unknown) => (e as HttpException).getStatus());
}

beforeAll(async () => {
  if (!TEST_DB_URL) return;
  db = getDb(TEST_DB_URL);
  await assertRlsEnforced(db);
  limits = new RateLimitService(db);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  if (!db) return;
  await db.delete(rateLimit).where(like(rateLimit.key, `${RUN}:%`));
  await closeDb();
});

describeIfDb('rate limits', () => {
  it('refuses the hit that goes over the limit, and only for that key', async () => {
    for (let i = 0; i < LIMIT; i++) await limits.consume(BUCKET, key('busy'));

    expect(await status(limits.consume(BUCKET, key('busy')))).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(await status(limits.check(BUCKET, key('busy')))).toBe(HttpStatus.TOO_MANY_REQUESTS);

    expect(await status(limits.consume(BUCKET, key('quiet')))).toBe(200);
    expect(await status(limits.check(BUCKET, key('untouched')))).toBe(200);
  });

  it('says why, in words a person can act on', async () => {
    for (let i = 0; i < LIMIT; i++) await limits.consume(BUCKET, key('wordy'));
    const refusal = await limits.consume(BUCKET, key('wordy')).catch((e: HttpException) => e);
    expect((refusal as HttpException).getResponse()).toEqual({
      code: 'RATE_LIMITED', message: LIMITS[BUCKET].message,
    });
  });

  it('checks without counting', async () => {
    for (let i = 0; i < 10; i++) await limits.check(BUCKET, key('looked-at'));
    for (let i = 0; i < LIMIT; i++) await limits.consume(BUCKET, key('looked-at'));
  });

  it('starts again in the next window', async () => {
    // Only Date is faked: the pg driver's timers must keep running.
    vi.useFakeTimers({ toFake: ['Date'] });
    const windowMs = LIMITS[BUCKET].windowSeconds * 1000;
    const start = Math.floor(Date.now() / windowMs) * windowMs;
    vi.setSystemTime(start + 1_000);

    for (let i = 0; i < LIMIT; i++) await limits.consume(BUCKET, key('tomorrow'));
    expect(await status(limits.consume(BUCKET, key('tomorrow')))).toBe(HttpStatus.TOO_MANY_REQUESTS);

    vi.setSystemTime(start + windowMs + 1_000);
    expect(await status(limits.consume(BUCKET, key('tomorrow')))).toBe(200);
  });

  it('counts every hit in a concurrent burst', async () => {
    // A read-then-write counter lets a burst all read "0" and all pass. The
    // upsert increments in the database, so exactly the limit gets through.
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => status(limits.consume(BUCKET, key('burst')))),
    );
    expect(outcomes.filter((s) => s === 200)).toHaveLength(LIMIT);
    expect(outcomes.filter((s) => s === HttpStatus.TOO_MANY_REQUESTS)).toHaveLength(10 - LIMIT);
  });
});
