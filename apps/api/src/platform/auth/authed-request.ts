import type { Request } from 'express';
import type { Actor } from '@peoplepulse/core';

export interface AuthedRequest extends Request {
  /** Set by AuthGuard. Absent on @Public routes. */
  actor?: Actor;
}

/**
 * The JWT payload.
 *
 * `tid` is the ACTIVE tenant — one, always. A user may belong to several
 * companies (D-16: the CA firm serving multiple clients), but a given token
 * speaks for exactly one of them, and switching re-issues the token.
 *
 * This is why multi-company membership does not weaken tenant isolation by an
 * inch: RLS still sees a single tenant per request. The switcher is a
 * login-time concern, not a data-layer one.
 *
 * Note what is NOT in here: permissions. They are loaded from the database on
 * every request. Embedding them would be faster, but it would mean revoking
 * someone's payroll access does nothing until their token expires — up to 15
 * minutes during which a dismissed employee can still finalize a payroll run.
 * The join is cheap; the stale-authorization window is not.
 */
export interface JwtPayload {
  sub: string;          // user id
  tid: string;          // active tenant id
  eid: string | null;   // employee id — null for external users (an accountant)
  mfa: boolean;         // has MFA been satisfied on this token?
  typ: 'access' | 'refresh';
}
