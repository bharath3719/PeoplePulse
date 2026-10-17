import { pgTable, text, timestamp, integer, primaryKey, index } from 'drizzle-orm/pg-core';

/**
 * Fixed-window request counters: how many times `key` — an IP address, an
 * email address, a company — has hit `bucket` — sign-in, signup, invitations —
 * in the window that began at `windowStart`.
 *
 * Outside RLS, like `user`: sign-in and signup are counted before any company
 * is known, and a key is not company data. It IS personal data — IP and email
 * addresses — so rows are deleted once they are a day old; no window is longer.
 *
 * TR-40 puts rate limits in Redis. Redis is not in the stack yet (it arrives
 * with the hosting decision, D-6); until it is, this table stands in behind
 * RateLimitService, whose two methods are all a Redis version must provide.
 */
export const rateLimit = pgTable('rate_limit', {
  bucket: text('bucket').notNull(),
  key: text('key').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  hits: integer('hits').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.bucket, t.key, t.windowStart] }),
  index('rate_limit_window_idx').on(t.windowStart),
]);
