import {
  Injectable, UnauthorizedException, BadRequestException, ForbiddenException, Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { eq, and, asc } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import {
  user, userTenant, userRole, role, rolePermission, tenant,
  withoutTenantIsolation, withTenant, type Database,
} from '@peoplepulse/db';
import { isPermission, requiresMfa, type Actor, type Permission } from '@peoplepulse/core';
import { DB } from '../database/database.module';
import type { JwtPayload } from './authed-request';

export interface TenantOption {
  id: string;
  name: string;
  slug: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  mfaRequired: boolean;
  activeTenant: TenantOption;
  /** Every company this user belongs to. More than one only for external accountants (D-16). */
  tenants: TenantOption[];
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
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
    /**
     * Login is inherently cross-tenant: we do not know which company this
     * person belongs to until we have found them. `user` and `user_tenant` are
     * deliberately outside RLS for exactly this reason.
     */
    return withoutTenantIsolation(this.db, 'login: tenant is not yet known', async (db) => {
      const [found] = await db.select().from(user)
        .where(eq(user.email, email.toLowerCase().trim()));

      /**
       * Verify the password even when the user does not exist, against a dummy
       * hash. Otherwise the response time tells an attacker which email
       * addresses are registered — and for an HR system, "who works here" is
       * itself sensitive.
       */
      const hash = found?.passwordHash ?? DUMMY_HASH;
      const ok = await argon2.verify(hash, password).catch(() => false);

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
      const mfaNeeded = requiresMfa([...permissions]);

      // MFA is required by what they CAN DO, not by what they are called — so a
      // custom role granted `payroll.run.finalize` requires it automatically.
      const mfaSatisfied = !mfaNeeded;

      await db.update(user).set({ lastLoginAt: new Date() }).where(eq(user.id, found.id));

      return {
        ...this.issueTokens({
          sub: found.id,
          tid: active.tenantId,
          eid: active.employeeId,
          mfa: mfaSatisfied,
        }),
        mfaRequired: mfaNeeded && !found.mfaEnabledAt
          ? true   // must enrol
          : mfaNeeded,
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
  async switchTenant(userId: string, toTenantId: string): Promise<LoginResult> {
    return withoutTenantIsolation(this.db, 'tenant switch: crosses tenants by definition', async (db) => {
      const memberships = await activeMemberships(db, userId);

      // 403, not 401. The caller is still signed in to the company they are in;
      // the web client treats any 401 as an expired session and signs them out.
      const target = memberships.find((m) => m.tenantId === toTenantId);
      if (!target) throw new ForbiddenException('You do not have access to that company');

      const permissions = await this.loadPermissions(userId, toTenantId);
      const mfaNeeded = requiresMfa([...permissions]);

      return {
        ...this.issueTokens({
          sub: userId, tid: target.tenantId, eid: target.employeeId, mfa: !mfaNeeded,
        }),
        mfaRequired: mfaNeeded,
        activeTenant: toOption(target),
        tenants: memberships.map(toOption),
      };
    });
  }

  async verifyMfa(userId: string, tenantId: string, code: string): Promise<{ accessToken: string; refreshToken: string }> {
    return withoutTenantIsolation(this.db, 'mfa: reads the global user record', async (db) => {
      const [found] = await db.select().from(user).where(eq(user.id, userId));
      if (!found?.mfaSecret) throw new BadRequestException('MFA is not enrolled');

      if (!authenticator.verify({ token: code, secret: found.mfaSecret })) {
        throw new UnauthorizedException('Invalid code');
      }

      const [membership] = await db.select().from(userTenant)
        .where(and(eq(userTenant.userId, userId), eq(userTenant.tenantId, tenantId)));

      return this.issueTokens({
        sub: userId, tid: tenantId, eid: membership?.employeeId ?? null, mfa: true,
      });
    });
  }

  /**
   * Resolve the Actor for a request: who, in which company, holding what.
   *
   * Permissions are read from the database EVERY request — see JwtPayload for
   * why. This is the hot path; it is a two-join query on indexed columns.
   */
  async resolveActor(payload: JwtPayload): Promise<Actor> {
    const permissions = await this.loadPermissions(payload.sub, payload.tid);

    return {
      userId: payload.sub,
      tenantId: payload.tid,
      employeeId: payload.eid,
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
  private async loadPermissions(userId: string, tenantId: string): Promise<ReadonlySet<Permission>> {
    const rows = await withTenant(this.db, tenantId, (tx) =>
      tx.select({ permission: rolePermission.permission })
        .from(userRole)
        .innerJoin(role, eq(role.id, userRole.roleId))
        .innerJoin(rolePermission, eq(rolePermission.roleId, role.id))
        .where(eq(userRole.userId, userId)));

    const permissions = new Set<Permission>();
    for (const row of rows) {
      // A permission that is no longer in the registry (removed in a refactor,
      // say) is IGNORED rather than trusted. Fail closed.
      if (isPermission(row.permission)) permissions.add(row.permission);
    }
    return permissions;
  }

  private issueTokens(payload: Omit<JwtPayload, 'typ'>): { accessToken: string; refreshToken: string } {
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
 * A real Argon2id hash of a value nobody knows, used to burn the same CPU time
 * on a missing user as on a real one. Without this, login latency is an oracle
 * for "does this person work here".
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0YkYK3Lqf0J1P3Bq3nqLKPFPr1oXKRGYLIsCQyKN7ZQ';
