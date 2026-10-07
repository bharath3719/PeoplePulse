import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { authenticator } from 'otplib';
import {
  getDb, closeDb, withTenant, withPurgeMode, assertRlsEnforced,
  tenant, user, userTenant, role, rolePermission, userRole, auditLog, type Database,
} from '@peoplepulse/db';
import type { Actor } from '@peoplepulse/core';
import { AuditService } from '../audit/audit.service';
import { PiiService } from '../crypto/pii.service';
import { AuthService } from './auth.service';
import type { JwtPayload } from './authed-request';

/**
 * The company switcher (D-16), against a real database.
 *
 * `user_tenant` sits outside RLS — login has to read it before any tenant is
 * known — so nothing but these queries stands between a user and a company they
 * do not belong to. Each test tries to reach one.
 *
 * Like the other DB suites, this FAILS without a database rather than skipping.
 */
const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const OPTED_OUT = process.env['SKIP_DB_TESTS'] === '1';

if (!OPTED_OUT && !TEST_DB_URL) {
  throw new Error(
    'The company-switcher suite cannot reach a database. Set TEST_DATABASE_URL ' +
      '(see .env.example), or SKIP_DB_TESTS=1 if you mean to run without one.',
  );
}

const describeIfDb = OPTED_OUT ? describe.skip : describe;

const SECRETS: Record<string, string> = {
  JWT_ACCESS_SECRET: 'test-only-access-secret',
  JWT_REFRESH_SECRET: 'test-only-refresh-secret',
  PII_ENCRYPTION_KEY: 'test-only-pii-key',
};
const config = {
  getOrThrow: (key: string) => SECRETS[key],
  get: (_key: string, fallback: unknown) => fallback,
} as unknown as ConfigService;

const PASSWORD = 'correct horse battery staple';

let db: Database;
let jwt: JwtService;
let pii: PiiService;
let service: AuthService;

const tenants: string[] = [];
const users: string[] = [];

// The CA firm's accountant: two client companies, plus one that let them go.
let accountant: string;
let accountantEmail: string;
let acme: string;     // member
let zenith: string;   // member
let globex: string;   // membership deactivated
let initech: string;  // someone else's company entirely

async function company(name: string): Promise<string> {
  const [row] = await db.insert(tenant)
    .values({ name, slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID().slice(0, 8)}` })
    .returning({ id: tenant.id });
  tenants.push(row!.id);
  return row!.id;
}

async function login(email: string): Promise<string> {
  const [row] = await db.insert(user)
    .values({ email, passwordHash: await AuthService.hashPassword(PASSWORD) })
    .returning({ id: user.id });
  users.push(row!.id);
  return row!.id;
}

beforeAll(async () => {
  if (!TEST_DB_URL) return;

  db = getDb(TEST_DB_URL);
  await assertRlsEnforced(db);

  jwt = new JwtService();
  pii = new PiiService(config);
  service = new AuthService(db, jwt, config, pii, new AuditService(db));

  // Created out of name order, so a passing order assertion means sorting
  // happened rather than insertion order leaking through.
  zenith = await company('Zenith Exports');
  acme = await company('Acme Textiles');
  globex = await company('Globex Motors');
  initech = await company('Initech Software');

  accountantEmail = `ca-${randomUUID().slice(0, 8)}@example.test`;
  accountant = await login(accountantEmail);
  const someoneElse = await login(`hr-${randomUUID().slice(0, 8)}@example.test`);

  await db.insert(userTenant).values([
    { userId: accountant, tenantId: zenith },
    { userId: accountant, tenantId: acme },
    { userId: accountant, tenantId: globex, isActive: false },
    { userId: someoneElse, tenantId: initech },
  ]);
});

afterAll(async () => {
  if (!db) return;
  for (const id of tenants) {
    await withPurgeMode(db, id, 'company-switcher test teardown', (tx) =>
      tx.delete(tenant).where(eq(tenant.id, id)));
  }
  if (users.length > 0) await db.delete(user).where(inArray(user.id, users));
  await closeDb();
});

describeIfDb('the company switcher', () => {
  it('lists every active membership, by name, and no one else\'s', async () => {
    const listed = await service.listTenants(accountant);

    expect(listed.map((t) => t.id)).toEqual([acme, zenith]);
    expect(listed[0]).toMatchObject({ name: 'Acme Textiles' });
  });

  it('logs in to the first company by name when none is named', async () => {
    const result = await service.login(accountantEmail, PASSWORD);

    expect(result.activeTenant.id).toBe(acme);
    expect(result.tenants.map((t) => t.id)).toEqual([acme, zenith]);
  });

  it('re-issues the token for the company switched to', async () => {
    const result = await service.switchTenant(accountant, zenith);

    const payload = jwt.verify<JwtPayload>(result.accessToken, { secret: SECRETS['JWT_ACCESS_SECRET']! });
    expect(payload.tid).toBe(zenith);
    expect(payload.sub).toBe(accountant);
    expect(result.activeTenant.id).toBe(zenith);
  });

  it('refuses a company whose membership was deactivated', async () => {
    await expect(service.switchTenant(accountant, globex)).rejects.toThrow(ForbiddenException);
  });

  it('refuses a company the user never belonged to', async () => {
    await expect(service.switchTenant(accountant, initech)).rejects.toThrow(ForbiddenException);
    await expect(service.switchTenant(accountant, randomUUID())).rejects.toThrow(ForbiddenException);
  });
});

/**
 * Two-factor authentication, against a real database.
 *
 * The second factor is the only thing between a stolen password and the bank
 * account salaries are paid into. Each test below tries to get an MFA-verified
 * token without holding the authenticator: a half-finished enrolment, a code
 * seen once and replayed, a re-enrolment with only the password, a burst of
 * guesses.
 *
 * On a fixed clock. TOTP codes change every 30 seconds, and a test that crosses
 * a boundary between minting a code and checking it would fail one run in a
 * few hundred, for no reason anyone could reproduce.
 */
describeIfDb('two-factor authentication', () => {
  const STEP_MS = 30_000;
  let now: number;

  let priya: string;        // enrols; in Acme (nothing gated) and Zenith (bank edit)
  let priyaEmail: string;
  let secret: string;

  /** The code an authenticator shows `offset` steps from the clock. */
  function code(forSecret: string, offset = 0): string {
    return authenticator.clone({ epoch: now + offset * STEP_MS }).generate(forSecret);
  }

  /** A code that is wrong for every step the window accepts. */
  function wrong(forSecret: string): string {
    const valid = new Set([-1, 0, 1].map((o) => code(forSecret, o)));
    for (let n = 0; ; n++) {
      const guess = String(n).padStart(6, '0');
      if (!valid.has(guess)) return guess;
    }
  }

  function advance(ms: number): void {
    now += ms;
    vi.setSystemTime(now);
  }

  function actor(userId: string, tenantId: string, mfaVerified = false): Actor {
    return { userId, tenantId, employeeId: null, permissions: new Set(), mfaVerified };
  }

  function claims(token: string): JwtPayload {
    return jwt.verify<JwtPayload>(token, { secret: SECRETS['JWT_ACCESS_SECRET']! });
  }

  async function rejection(attempt: Promise<unknown>): Promise<unknown> {
    return attempt.then(() => { throw new Error('expected a rejection'); }, (e: unknown) => e);
  }

  async function auditActions(tenantId: string, userId: string): Promise<string[]> {
    return withTenant(db, tenantId, async (tx) =>
      (await tx.select({ action: auditLog.action }).from(auditLog)
        .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, userId))))
        .map((r) => r.action));
  }

  /** Someone already through enrolment, straight into the table. */
  async function enrolled(name: string, tenantId: string): Promise<{ id: string; secret: string }> {
    const own = authenticator.generateSecret(20);
    const id = await login(`${name}-${randomUUID().slice(0, 8)}@example.test`);
    await db.update(user).set({ mfaSecret: pii.encrypt(own), mfaEnabledAt: new Date() })
      .where(eq(user.id, id));
    await db.insert(userTenant).values({ userId: id, tenantId });
    return { id, secret: own };
  }

  beforeAll(async () => {
    // Only Date is faked: the pg driver's timers must keep running.
    vi.useFakeTimers({ toFake: ['Date'] });
    // 10 seconds into a step, so offsets of ±1 step never straddle a boundary.
    now = Math.floor(Date.now() / STEP_MS) * STEP_MS + 10_000;
    vi.setSystemTime(now);

    priyaEmail = `priya-${randomUUID().slice(0, 8)}@example.test`;
    priya = await login(priyaEmail);
    await db.insert(userTenant).values([
      { userId: priya, tenantId: acme },
      { userId: priya, tenantId: zenith },
    ]);

    // In Zenith she may change where salaries are paid, which needs MFA.
    await withTenant(db, zenith, async (tx) => {
      const [clerk] = await tx.insert(role)
        .values({ tenantId: zenith, key: 'BANK_CLERK', name: 'Bank clerk' })
        .returning({ id: role.id });
      await tx.insert(rolePermission)
        .values({ roleId: clerk!.id, tenantId: zenith, permission: 'employee.bank.edit' });
      await tx.insert(userRole).values({ userId: priya, roleId: clerk!.id, tenantId: zenith });
    });
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('issues a token that vouches for no second factor at login — even to a user who needs none', async () => {
    // Priya holds nothing gated in Acme. The claim used to be `!requiresMfa`,
    // so this token said `mfa: true` — and a gated permission granted to her
    // mid-session would have been usable without a code.
    const result = await service.login(priyaEmail, PASSWORD, acme);

    expect(claims(result.accessToken).mfa).toBe(false);
    expect(result).toMatchObject({ mfaRequired: false, mfaEnrolled: false });
  });

  it('says MFA is required where her permissions need it', async () => {
    const result = await service.login(priyaEmail, PASSWORD, zenith);

    expect(claims(result.accessToken).mfa).toBe(false);
    expect(result).toMatchObject({ mfaRequired: true, mfaEnrolled: false });
  });

  it('refuses a code from someone who has not enrolled', async () => {
    const refused = await rejection(service.verifyMfa(actor(priya, acme), '123456'));
    expect(refused).toBeInstanceOf(BadRequestException);
  });

  it('hands over the secret once, and stores it encrypted', async () => {
    const enrolment = await service.startMfaEnrolment(actor(priya, acme));
    secret = enrolment.secret;

    expect(enrolment.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(enrolment.otpauthUri).toContain('issuer=PeoplePulse');
    expect(enrolment.otpauthUri).toContain(encodeURIComponent(priyaEmail));
    expect(enrolment.qrCode).toMatch(/^data:image\/png;base64,/);

    const [row] = await db.select().from(user).where(eq(user.id, priya));
    expect(row!.mfaSecret).not.toContain(secret);
    expect(row!.mfaSecret).toMatch(/^v1:/);
    expect(row!.mfaEnabledAt).toBeNull();
  });

  it('verifies nothing against a half-finished enrolment', async () => {
    // The code is right for the pending secret — but nobody has proved the
    // phone received it, so it must not count yet.
    const refused = await rejection(service.verifyMfa(actor(priya, acme), code(secret)));
    expect(refused).toBeInstanceOf(BadRequestException);
  });

  it('replaces the pending secret when enrolment starts again', async () => {
    const first = secret;
    secret = (await service.startMfaEnrolment(actor(priya, acme))).secret;

    expect(secret).not.toBe(first);
    const refused = await rejection(service.confirmMfaEnrolment(actor(priya, acme), code(first, -1)));
    expect(refused).toBeInstanceOf(BadRequestException);
  });

  it('switches MFA on with a matching code, and audits it', async () => {
    // The code from one step ago: the window allows it, and it leaves "now"
    // and "next" free for the tests that follow.
    const tokens = await service.confirmMfaEnrolment(actor(priya, acme), code(secret, -1));

    expect(claims(tokens.accessToken)).toMatchObject({ sub: priya, tid: acme, mfa: true });

    const [row] = await db.select().from(user).where(eq(user.id, priya));
    expect(row!.mfaEnabledAt).not.toBeNull();
    expect(await auditActions(acme, priya)).toContain('MFA_ENROLLED');
  });

  it('refuses to enrol again: a password alone must not replace the authenticator', async () => {
    expect(await rejection(service.startMfaEnrolment(actor(priya, acme)))).toBeInstanceOf(ConflictException);
    expect(await rejection(service.confirmMfaEnrolment(actor(priya, acme), code(secret))))
      .toBeInstanceOf(ConflictException);

    const [row] = await db.select().from(user).where(eq(user.id, priya));
    expect(pii.decrypt(row!.mfaSecret!)).toBe(secret);
  });

  it('refuses the code that confirmed enrolment', async () => {
    const refused = await rejection(service.verifyMfa(actor(priya, acme), code(secret, -1)));
    expect(refused).toBeInstanceOf(BadRequestException);
  });

  it('accepts a fresh code once, and never again', async () => {
    const tokens = await service.verifyMfa(actor(priya, acme), code(secret));
    expect(claims(tokens.accessToken)).toMatchObject({ sub: priya, tid: acme, mfa: true });

    // Read over a shoulder, typed again within the minute.
    const replayed = await rejection(service.verifyMfa(actor(priya, acme), code(secret)));
    expect(replayed).toBeInstanceOf(BadRequestException);

    // The next code still works: one replay is not a lockout.
    const next = await service.verifyMfa(actor(priya, acme), code(secret, 1));
    expect(claims(next.accessToken).mfa).toBe(true);
  });

  it('carries a verified second factor across a company switch, and only a verified one', async () => {
    const verified = await service.switchTenant(priya, zenith, true);
    expect(claims(verified.accessToken)).toMatchObject({ tid: zenith, mfa: true });
    expect(verified).toMatchObject({ mfaRequired: true, mfaEnrolled: true });

    const unverified = await service.switchTenant(priya, zenith);
    expect(claims(unverified.accessToken).mfa).toBe(false);
  });

  it('locks after five wrong codes, refuses even the right one, and audits it', async () => {
    const victim = await enrolled('locked', acme);
    const as = actor(victim.id, acme);

    for (let i = 0; i < 4; i++) {
      expect(await rejection(service.verifyMfa(as, wrong(victim.secret)))).toBeInstanceOf(BadRequestException);
    }
    const fifth = await rejection(service.verifyMfa(as, wrong(victim.secret)));
    expect(fifth).toBeInstanceOf(HttpException);
    expect((fifth as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);

    const right = await rejection(service.verifyMfa(as, code(victim.secret)));
    expect((right as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(await auditActions(acme, victim.id)).toContain('MFA_LOCKED');

    // Fifteen minutes on, the right code works and the count starts over.
    advance(15 * 60_000 + 1_000);
    const tokens = await service.verifyMfa(as, code(victim.secret));
    expect(claims(tokens.accessToken).mfa).toBe(true);
  });

  it('counts every guess in a parallel burst', async () => {
    const victim = await enrolled('burst', acme);
    const as = actor(victim.id, acme);

    // Open eight connections first. Otherwise each request waits on a fresh
    // connection's handshake, which takes longer than a whole verification, so
    // the "burst" arrives one at a time and passes with or without the lock.
    await Promise.all(Array.from({ length: 8 }, () => db.execute(sql`select pg_sleep(0.05)`)));

    // Without the row lock, all eight read "0 attempts" and all eight get a try.
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => rejection(service.verifyMfa(as, wrong(victim.secret)))),
    );
    const statuses = outcomes.map((e) => (e as HttpException).getStatus()).sort();

    expect(statuses).toEqual([400, 400, 400, 400, 429, 429, 429, 429]);
  });

  it('mints no token for a membership revoked since the last one', async () => {
    // The accountant's Globex membership is deactivated; an old token still names it.
    const refused = await rejection(service.verifyMfa(actor(accountant, globex), '123456'));
    expect(refused).toBeInstanceOf(ForbiddenException);
  });
});
