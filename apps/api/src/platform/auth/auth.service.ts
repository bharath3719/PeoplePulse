import { createHash, randomBytes } from 'node:crypto';
import {
  Injectable, UnauthorizedException, BadRequestException, ForbiddenException, ConflictException,
  HttpException, HttpStatus, Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { eq, and, asc, isNull } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import {
  user, userTenant, userRole, role, rolePermission, tenant,
  withoutTenantIsolation, withTenant, type Database, type TenantDatabase, type User, type NewUser,
} from '@peoplepulse/db';
import {
  isPermission, normaliseRecoveryCode, requiresMfa, type Actor, type Permission,
} from '@peoplepulse/core';
import { DB } from '../database/database.module';
import { AuditService, type AuditEntry } from '../audit/audit.service';
import { PiiService } from '../crypto/pii.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { validationFailed } from '../validation/zod.pipe';
import type { JwtPayload } from './authed-request';

export interface TenantOption {
  id: string;
  name: string;
  slug: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface MfaStatus {
  /** Something this user may do in the active company needs a second factor. */
  mfaRequired: boolean;
  /** They have an authenticator set up, so a code can be asked for. */
  mfaEnrolled: boolean;
  /** Unused recovery codes. Zero for someone who set up before codes existed. */
  recoveryCodesLeft: number;
}

/** Shown once, when issued: only their hashes are kept. */
export interface RecoveryCodes {
  recoveryCodes: string[];
}

export interface LoginResult extends Tokens, MfaStatus {
  activeTenant: TenantOption;
  /** Every company this user belongs to. More than one only for external accountants (D-16). */
  tenants: TenantOption[];
}

export interface MfaEnrolment {
  /** Base32, for typing into an authenticator app that cannot scan. */
  secret: string;
  otpauthUri: string;
  /** The same URI as a QR code, a data: URL for an <img>. */
  qrCode: string;
}

/** Shown in the authenticator app beside the code. */
const MFA_ISSUER = 'PeoplePulse';

/**
 * Recovery codes issued per set. Each is 80 random bits, written as 16 base32
 * characters in groups of four.
 */
const RECOVERY_CODE_COUNT = 10;

/** Wrong codes in a row before verification locks, and for how long. */
const MFA_MAX_ATTEMPTS = 5;
const MFA_LOCKOUT_MS = 15 * 60_000;

/**
 * RFC 6238 defaults: a new code every 30 seconds. `window: 1` also accepts the
 * code either side of now, because phone clocks drift and people type slowly.
 */
const TOTP_STEP_SECONDS = 30;
const totp = authenticator.clone({ step: TOTP_STEP_SECONDS, window: 1 });

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly pii: PiiService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
  ) {}

  /**
   * Argon2id, per TR-50. Never bcrypt, never a fast hash — these hashes protect
   * accounts that can see salary and bank details.
   */
  static hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 19_456, // 19 MiB — OWASP's floor
      timeCost: 2,
      parallelism: 1,
    });
  }

  async login(email: string, password: string, tenantId?: string): Promise<LoginResult> {
    const address = email.toLowerCase().trim();

    // Before the password is looked at: a locked account costs no Argon2 time,
    // and says the same thing whether or not the address has a login.
    await this.limits.check('wrongPasswords', address);

    /**
     * Login is inherently cross-tenant: we do not know which company this
     * person belongs to until we have found them. `user` and `user_tenant` are
     * deliberately outside RLS for exactly this reason.
     */
    return withoutTenantIsolation(this.db, 'login: tenant is not yet known', async (db) => {
      const [found] = await db.select().from(user)
        .where(eq(user.email, address));

      /**
       * Verify the password even when the user does not exist, against a dummy
       * hash. Otherwise the response time tells an attacker which email
       * addresses are registered — and for an HR system, "who works here" is
       * itself sensitive.
       */
      const hash = found?.passwordHash ?? DUMMY_HASH;
      const ok = await argon2.verify(hash, password).catch(() => false);

      // Counted for addresses with no login too: otherwise only real accounts
      // would ever lock, and the lock would answer "does this person work here".
      if (!ok) await this.limits.consume('wrongPasswords', address);
      if (!found || !ok || !found.isActive) throw new UnauthorizedException('Invalid credentials');

      const memberships = await activeMemberships(db, found.id);

      if (memberships.length === 0) {
        throw new UnauthorizedException('This account is not attached to any company');
      }

      // Which company are we logging in to? If they asked for one, honour it —
      // but only if they actually belong to it.
      const active = tenantId
        ? memberships.find((m) => m.tenantId === tenantId)
        : memberships[0];

      if (!active) throw new UnauthorizedException('You do not have access to that company');

      const permissions = await this.loadPermissions(found.id, active.tenantId);

      await db.update(user).set({ lastLoginAt: new Date() }).where(eq(user.id, found.id));

      return {
        // `mfa: false` for everyone, including users who need no MFA. The claim
        // says a second factor WAS VERIFIED, not that none is needed: it used to
        // be `!requiresMfa(permissions)`, so a user granted `employee.bank.edit`
        // mid-session carried a token that already vouched for a code they had
        // never entered. Permissions are re-read every request; the token is not.
        ...this.issueTokens({
          sub: found.id, tid: active.tenantId, eid: active.employeeId, mfa: false,
        }),
        ...mfaStatusOf(permissions, found),
        activeTenant: toOption(active),
        tenants: memberships.map(toOption),
      };
    });
  }

  /**
   * Every company this user may switch to — what the company switcher lists.
   * Served from /auth/me rather than remembered from login, so a membership
   * granted or revoked since then shows up on the next page load.
   */
  async listTenants(userId: string): Promise<TenantOption[]> {
    return withoutTenantIsolation(this.db, 'company switcher: lists every company the user belongs to', async (db) =>
      (await activeMemberships(db, userId)).map(toOption));
  }

  /**
   * Switch company (D-16). Re-issues the token against a different tenant.
   *
   * The membership is re-checked here rather than trusted from the old token —
   * access may have been revoked since it was issued.
   */
  async switchTenant(userId: string, toTenantId: string, mfaVerified = false): Promise<LoginResult> {
    return withoutTenantIsolation(this.db, 'tenant switch: crosses tenants by definition', async (db) => {
      const memberships = await activeMemberships(db, userId);

      // 403, not 401. The caller is still signed in to the company they are in;
      // the web client treats any 401 as an expired session and signs them out.
      const target = memberships.find((m) => m.tenantId === toTenantId);
      if (!target) throw new ForbiddenException('You do not have access to that company');

      const permissions = await this.loadPermissions(userId, toTenantId);
      const [found] = await db.select({ mfaEnabledAt: user.mfaEnabledAt, mfaRecoveryCodes: user.mfaRecoveryCodes })
        .from(user).where(eq(user.id, userId));

      return {
        // A verified second factor carries across: it proved the PERSON holds
        // their authenticator, which does not depend on the company they are
        // looking at. Asking the CA firm's accountant for a fresh code at every
        // switch would buy nothing.
        ...this.issueTokens({
          sub: userId, tid: target.tenantId, eid: target.employeeId, mfa: mfaVerified,
        }),
        ...mfaStatusOf(permissions, found ?? NO_MFA),
        activeTenant: toOption(target),
        tenants: memberships.map(toOption),
      };
    });
  }

  /** For /auth/me: so the web app knows, on any page load, whether to ask for a code. */
  async mfaStatus(actor: Actor): Promise<MfaStatus> {
    const [found] = await withoutTenantIsolation(this.db, 'mfa: the login is global, not per company', (db) =>
      db.select({ mfaEnabledAt: user.mfaEnabledAt, mfaRecoveryCodes: user.mfaRecoveryCodes })
        .from(user).where(eq(user.id, actor.userId)));
    return mfaStatusOf(actor.permissions, found ?? NO_MFA);
  }

  /**
   * Start setting up an authenticator: mint a secret and hand it over once, as
   * a QR code and as text. It stays pending — verifying nothing — until
   * `confirmMfaEnrolment` sees a code from it.
   *
   * The first time, this runs on a half-authenticated token — the only kind a
   * user without MFA can hold. So whoever has the password first can enrol
   * their own phone: trust on first use, the same as every TOTP rollout. The
   * guard against it is ordering — enrol at first sign-in, before the password
   * has had time to leak.
   *
   * Once MFA is on, only a token that has passed a code — or a recovery code,
   * when the phone is gone — may start a replacement. Otherwise a stolen
   * password alone could swap the victim's authenticator for the thief's, and
   * the second factor would be worth exactly as much as the first. The working
   * authenticator stays on until the new one is confirmed, so an abandoned
   * replacement locks nobody out.
   *
   * Starting again before confirming replaces the pending secret, so scanning
   * the QR code twice cannot leave two phones generating valid codes.
   */
  async startMfaEnrolment(actor: Actor): Promise<MfaEnrolment> {
    const secret = authenticator.generateSecret(20); // 160 bits, RFC 4226's recommendation

    const [found] = await withoutTenantIsolation(this.db, 'mfa: the login is global, not per company', (db) =>
      db.update(user)
        .set({ mfaPendingSecret: this.pii.encrypt(secret), updatedAt: new Date() })
        .where(and(eq(user.id, actor.userId), actor.mfaVerified ? undefined : isNull(user.mfaEnabledAt)))
        .returning({ email: user.email }));

    if (!found) throw new ConflictException('Two-factor authentication is already set up');

    const otpauthUri = totp.keyuri(found.email, MFA_ISSUER, secret);
    return { secret, otpauthUri, qrCode: await QRCode.toDataURL(otpauthUri) };
  }

  /**
   * Finish enrolment: the first code from the new authenticator proves it
   * holds the pending secret. Only now does it count, replacing any old one —
   * and this token is MFA-verified, because the user has just produced a code.
   *
   * Issues a fresh set of recovery codes, shown once. A replacement usually
   * follows a lost phone, often recovered from with one of the old codes; the
   * rest of that set might be on the same lost piece of paper.
   *
   * Runs in the active company's transaction so the audit entry commits with
   * the change. `user` itself is outside RLS; the tenant context only decides
   * whose audit log records it.
   */
  async confirmMfaEnrolment(actor: Actor, code: string): Promise<Tokens & RecoveryCodes> {
    const { employeeId, recoveryCodes } = await withTenant(this.db, actor.tenantId, async (tx) => {
      const membership = await activeMembership(tx, actor);
      const found = await lockUser(tx, actor.userId);

      const replacing = Boolean(found.mfaEnabledAt);
      if (replacing && !actor.mfaVerified) {
        throw new ConflictException('Two-factor authentication is already set up');
      }
      if (!found.mfaPendingSecret) {
        throw new BadRequestException('Start setting up two-factor authentication first');
      }

      // No attempt limit here. Whoever is confirming generated this secret a
      // moment ago; there is nothing to guess.
      const step = matchingStep(code, this.pii.decrypt(found.mfaPendingSecret), Date.now());
      if (step === null) throw wrongCode();

      const codes = newRecoveryCodes();
      await tx.update(user).set({
        mfaSecret: found.mfaPendingSecret,
        mfaPendingSecret: null,
        mfaEnabledAt: new Date(),
        // So the code that confirmed enrolment cannot also be replayed to verify.
        mfaLastUsedStep: step,
        mfaFailedAttempts: 0,
        mfaLockedUntil: null,
        mfaRecoveryCodes: codes.map(hashRecoveryCode),
        updatedAt: new Date(),
      }).where(eq(user.id, actor.userId));

      await this.audit.record(tx, actor, {
        entity: 'user', entityId: actor.userId, action: replacing ? 'MFA_REPLACED' : 'MFA_ENROLLED',
      });
      return { employeeId: membership.employeeId, recoveryCodes: codes };
    });

    return {
      ...this.issueTokens({ sub: actor.userId, tid: actor.tenantId, eid: employeeId, mfa: true }),
      recoveryCodes,
    };
  }

  /** A code from the authenticator, for an MFA-verified token. */
  async verifyMfa(actor: Actor, code: string): Promise<Tokens> {
    const { tokens } = await this.verifySecondFactor(actor, (found, now) => {
      const step = matchingStep(code, this.pii.decrypt(found.mfaSecret!), now);
      // A code already accepted — or one older than it — is refused exactly as
      // a wrong one is, and counts as an attempt (RFC 6238 §5.2).
      const fresh = step !== null && (found.mfaLastUsedStep === null || step > found.mfaLastUsedStep);
      return fresh ? { set: { mfaLastUsedStep: step } } : null;
    }, wrongCode);
    return tokens;
  }

  /**
   * A recovery code in place of the authenticator, for when the phone is gone.
   * Each works once. Wrong ones count toward the same lockout as wrong codes:
   * they are a second way to guess at the same door.
   *
   * The verified token this returns may set up a replacement authenticator,
   * which is the point — after this, the user should.
   */
  async recoverMfa(actor: Actor, recoveryCode: string): Promise<Tokens & { recoveryCodesLeft: number }> {
    const hash = hashRecoveryCode(recoveryCode);

    const { tokens, set } = await this.verifySecondFactor(actor, (found) => {
      if (!found.mfaRecoveryCodes.includes(hash)) return null;
      const left = found.mfaRecoveryCodes.filter((h) => h !== hash);
      return {
        set: { mfaRecoveryCodes: left },
        // Worth a line an admin can find: either the phone is lost, or the
        // password and a code have been.
        audit: {
          entity: 'user', entityId: actor.userId, action: 'MFA_RECOVERY_CODE_USED', after: { left: left.length },
        },
      };
    }, () => validationFailed([{
      field: 'recoveryCode',
      message: 'That recovery code didn’t match, or has already been used.',
    }]));

    return { ...tokens, recoveryCodesLeft: set.mfaRecoveryCodes!.length };
  }

  /**
   * A new set of recovery codes, replacing the old — for someone who has used
   * some, or cannot find them. Only on a verified token: the codes are as good
   * as the authenticator, so minting them needs proof of holding it.
   */
  async regenerateRecoveryCodes(actor: Actor): Promise<RecoveryCodes> {
    if (!actor.mfaVerified) {
      throw new ForbiddenException({
        code: 'MFA_REQUIRED',
        detail: 'New recovery codes need a code from your authenticator first.',
      });
    }

    return withTenant(this.db, actor.tenantId, async (tx) => {
      await activeMembership(tx, actor);
      const found = await lockUser(tx, actor.userId);
      if (!found.mfaEnabledAt) {
        throw new BadRequestException({ code: 'MFA_NOT_ENROLLED', message: 'Set up two-factor authentication first' });
      }

      const codes = newRecoveryCodes();
      await tx.update(user).set({ mfaRecoveryCodes: codes.map(hashRecoveryCode), updatedAt: new Date() })
        .where(eq(user.id, actor.userId));
      await this.audit.record(tx, actor, {
        entity: 'user', entityId: actor.userId, action: 'MFA_RECOVERY_CODES_REISSUED',
      });
      return { recoveryCodes: codes };
    });
  }

  /**
   * The second factor, for a user who has one: `check` decides whether this
   * attempt — a code, or a recovery code — is good, and what to record if so.
   *
   * The user row is locked for the check, so concurrent guesses queue up and
   * each one is counted — without the lock, a burst of parallel requests would
   * all read the same attempt count and all get a try.
   *
   * A wrong attempt must COMMIT its count, so the transaction returns an
   * outcome and the refusal is thrown after it, never inside it: an exception
   * in there would roll the count back and make the limit decorative.
   */
  private async verifySecondFactor(
    actor: Actor,
    check: (found: User, now: number) => { set: Partial<NewUser>; audit?: AuditEntry } | null,
    refusal: () => Error,
  ): Promise<{ tokens: Tokens; set: Partial<NewUser> }> {
    const now = Date.now();

    const outcome = await withTenant(this.db, actor.tenantId, async (tx) => {
      const membership = await activeMembership(tx, actor);
      const found = await lockUser(tx, actor.userId);

      if (!found.mfaSecret || !found.mfaEnabledAt) {
        throw new BadRequestException({
          code: 'MFA_NOT_ENROLLED',
          message: 'Set up two-factor authentication first',
        });
      }

      if (found.mfaLockedUntil && found.mfaLockedUntil.getTime() > now) {
        return { kind: 'locked', until: found.mfaLockedUntil } as const;
      }

      const passed = check(found, now);

      if (!passed) {
        const attempts = found.mfaFailedAttempts + 1;
        if (attempts < MFA_MAX_ATTEMPTS) {
          await tx.update(user).set({ mfaFailedAttempts: attempts }).where(eq(user.id, actor.userId));
          return { kind: 'wrong' } as const;
        }

        const until = new Date(now + MFA_LOCKOUT_MS);
        await tx.update(user).set({ mfaFailedAttempts: 0, mfaLockedUntil: until })
          .where(eq(user.id, actor.userId));

        // Five wrong codes from someone who already has the password is the
        // pattern of a stolen password. Worth a line an admin can find.
        await this.audit.record(tx, actor, {
          entity: 'user', entityId: actor.userId, action: 'MFA_LOCKED',
          after: { failedAttempts: attempts, lockedUntil: until.toISOString() },
        });
        return { kind: 'locked', until } as const;
      }

      await tx.update(user).set({ mfaFailedAttempts: 0, mfaLockedUntil: null, ...passed.set })
        .where(eq(user.id, actor.userId));
      if (passed.audit) await this.audit.record(tx, actor, passed.audit);
      return { kind: 'verified', employeeId: membership.employeeId, set: passed.set } as const;
    });

    if (outcome.kind === 'wrong') throw refusal();

    if (outcome.kind === 'locked') {
      const minutes = Math.max(1, Math.ceil((outcome.until.getTime() - now) / 60_000));
      throw new HttpException({
        code: 'MFA_LOCKED',
        message: `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    return {
      tokens: this.issueTokens({ sub: actor.userId, tid: actor.tenantId, eid: outcome.employeeId, mfa: true }),
      set: outcome.set,
    };
  }

  /**
   * Resolve the Actor for a request: who, in which company, holding what.
   *
   * Permissions are read from the database EVERY request — see JwtPayload for
   * why. This is the hot path: a primary-key lookup and a two-join query on
   * indexed columns, in one transaction.
   *
   * The membership is checked as well as the roles. Removing someone deletes
   * their roles too, but a token must not outlive the membership on the
   * strength of that alone: a removed user with no roles still reaches every
   * route that needs no permission, and a disabled login still reaches all of
   * them. 401, because the token now speaks for nobody — the web client signs
   * them out, and signing in again lands them in a company they still belong to.
   */
  async resolveActor(payload: JwtPayload): Promise<Actor> {
    const { employeeId, permissions } = await withTenant(this.db, payload.tid, async (tx) => {
      const [member] = await tx.select({ employeeId: userTenant.employeeId }).from(userTenant)
        .innerJoin(user, eq(user.id, userTenant.userId))
        .where(and(
          eq(userTenant.userId, payload.sub),
          eq(userTenant.tenantId, payload.tid),
          eq(userTenant.isActive, true),
          eq(user.isActive, true),
        ));
      if (!member) throw new UnauthorizedException();
      return { employeeId: member.employeeId, permissions: await permissionsIn(tx, payload.sub) };
    });

    return {
      userId: payload.sub,
      tenantId: payload.tid,
      // From the membership, not the token's `eid`, for the reason permissions
      // are (see JwtPayload): an admin who unlinks a login from an employee
      // record (D-26) must not leave it reading that person's leave until the
      // token expires. The row is already being read; the column is free.
      employeeId,
      permissions,
      mfaVerified: payload.mfa,
    };
  }

  /**
   * A user's permissions in ONE company: the flattened union of every role they
   * hold there.
   *
   * Runs inside the tenant context, so RLS guarantees we cannot accidentally
   * pick up a role from a different company — which, for a user who belongs to
   * several (the CA firm), would be a privilege-escalation bug rather than a
   * mere leak.
   */
  private loadPermissions(userId: string, tenantId: string): Promise<ReadonlySet<Permission>> {
    return withTenant(this.db, tenantId, (tx) => permissionsIn(tx, userId));
  }

  private issueTokens(payload: Omit<JwtPayload, 'typ'>): Tokens {
    return {
      accessToken: this.jwt.sign({ ...payload, typ: 'access' }, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_TTL', '15m'),
      }),
      refreshToken: this.jwt.sign({ ...payload, typ: 'refresh' }, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_TTL', '30d'),
      }),
    };
  }
}

/** See loadPermissions. `tx` must already be in the company's tenant context. */
async function permissionsIn(tx: TenantDatabase, userId: string): Promise<ReadonlySet<Permission>> {
  const rows = await tx.select({ permission: rolePermission.permission })
    .from(userRole)
    .innerJoin(role, eq(role.id, userRole.roleId))
    .innerJoin(rolePermission, eq(rolePermission.roleId, role.id))
    .where(eq(userRole.userId, userId));

  const permissions = new Set<Permission>();
  for (const row of rows) {
    // A permission that is no longer in the registry (removed in a refactor,
    // say) is IGNORED rather than trusted. Fail closed.
    if (isPermission(row.permission)) permissions.add(row.permission);
  }
  return permissions;
}

/**
 * The companies a user belongs to, active memberships only. `user_tenant` sits
 * outside RLS, so callers hold a withoutTenantIsolation handle.
 *
 * Ordered by name: the switcher lists them that way, and login with no tenant
 * named lands on the first, which must not depend on heap order.
 */
function activeMemberships(db: Database, userId: string) {
  return db.select({
    tenantId: userTenant.tenantId,
    employeeId: userTenant.employeeId,
    name: tenant.name,
    slug: tenant.slug,
  })
    .from(userTenant)
    .innerJoin(tenant, eq(tenant.id, userTenant.tenantId))
    .where(and(eq(userTenant.userId, userId), eq(userTenant.isActive, true)))
    .orderBy(asc(tenant.name), asc(tenant.id));
}

function toOption(m: { tenantId: string; name: string; slug: string }): TenantOption {
  return { id: m.tenantId, name: m.name, slug: m.slug };
}

/**
 * MFA is required by what a user CAN DO in this company, not by what their role
 * is called — so a custom role granted `payroll.run.finalize` requires it
 * automatically.
 */
function mfaStatusOf(
  permissions: ReadonlySet<Permission>, found: { mfaEnabledAt: Date | null; mfaRecoveryCodes: string[] },
): MfaStatus {
  return {
    mfaRequired: requiresMfa([...permissions]),
    mfaEnrolled: Boolean(found.mfaEnabledAt),
    recoveryCodesLeft: found.mfaEnabledAt ? found.mfaRecoveryCodes.length : 0,
  };
}

const NO_MFA = { mfaEnabledAt: null, mfaRecoveryCodes: [] };

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** A fresh set of recovery codes, as the user is shown them: `abcd-efgh-ijkm-nopq`. */
function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const bytes = randomBytes(10); // 80 bits: 16 base32 characters exactly
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of bytes) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        out += BASE32[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    return out.match(/.{4}/g)!.join('-');
  });
}

/**
 * A plain SHA-256, as for invitation tokens: 80 random bits leave no dictionary
 * to slow down, and lookup must compare against ten of them per attempt.
 */
function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
}

/**
 * The actor's membership of their active company, re-read rather than trusted
 * from the token: both MFA endpoints mint a new one, and must not mint it for a
 * membership revoked since the old one was issued. 403, not 401 — see
 * switchTenant.
 */
async function activeMembership(tx: TenantDatabase, actor: Actor) {
  const [membership] = await tx.select({ employeeId: userTenant.employeeId }).from(userTenant)
    .where(and(
      eq(userTenant.userId, actor.userId),
      eq(userTenant.tenantId, actor.tenantId),
      eq(userTenant.isActive, true),
    ));
  if (!membership) throw new ForbiddenException('You no longer have access to this company');
  return membership;
}

/** The login row, locked until the transaction ends. */
async function lockUser(tx: TenantDatabase, userId: string) {
  const [found] = await tx.select().from(user).where(eq(user.id, userId)).for('update');
  if (!found) throw new UnauthorizedException();
  return found;
}

/**
 * The time step a code belongs to — unix seconds / 30 — or null if it matches
 * none in the window. The step, not just yes/no, so a used code can be refused.
 */
function matchingStep(code: string, secret: string, now: number): number | null {
  const delta = totp.clone({ epoch: now }).checkDelta(code, secret);
  return delta === null ? null : Math.floor(now / 1000 / TOTP_STEP_SECONDS) + delta;
}

/**
 * 400 against the field, never 401: the web client reads a 401 on an
 * authenticated request as an expired session and signs the user out — over a
 * typo.
 */
function wrongCode() {
  return validationFailed([{
    field: 'code',
    message: 'That code didn’t match. Check your phone’s clock is set automatically, then try the next code.',
  }]);
}

/**
 * A real Argon2id hash of a value nobody knows, used to burn the same CPU time
 * on a missing user as on a real one. Without this, login latency is an oracle
 * for "does this person work here".
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0YkYK3Lqf0J1P3Bq3nqLKPFPr1oXKRGYLIsCQyKN7ZQ';
