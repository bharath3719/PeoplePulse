import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  BadRequestException, ConflictException, ForbiddenException, GoneException, NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  getDb, closeDb, withTenant, withPurgeMode, assertRlsEnforced,
  tenant, user, userTenant, userRole, role, userInvitation, auditLog, type Database,
} from '@peoplepulse/db';
import { SYSTEM_ROLES, ALL_PERMISSIONS, type Actor, type Permission } from '@peoplepulse/core';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthService } from '../../platform/auth/auth.service';
import { PiiService } from '../../platform/crypto/pii.service';
import type { JwtPayload } from '../../platform/auth/authed-request';
import { TenantService } from '../tenant/tenant.service';
import { UserService } from './user.service';

/**
 * Inviting someone into a company (D-16), against a real database.
 *
 * Accepting is public, crosses into a company the invitee does not yet belong
 * to, and can attach an existing login — the CA firm's accountant — to a new
 * company. Each test below tries to make one of those go somewhere it should
 * not: a role the inviter does not hold, a company the token was not for, an
 * account whose password the link holder does not know.
 *
 * Like the other DB suites, this FAILS without a database rather than skipping.
 */
const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const OPTED_OUT = process.env['SKIP_DB_TESTS'] === '1';

if (!OPTED_OUT && !TEST_DB_URL) {
  throw new Error(
    'The user-invitation suite cannot reach a database. Set TEST_DATABASE_URL ' +
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
const RUN = randomUUID().slice(0, 8);

let db: Database;
let jwt: JwtService;
let auth: AuthService;
let service: UserService;

const tenants: string[] = [];
const emails: string[] = [];

let acme: string;
let globex: string;
let acmeOwner: Actor;
let acmeHr: Actor;
let globexOwner: Actor;

function email(name: string): string {
  const address = `${name}-${RUN}@example.test`;
  emails.push(address);
  return address;
}

function permissionsOf(key: string): Permission[] {
  return [...SYSTEM_ROLES.find((r) => r.key === key)!.permissions];
}

function actorIn(tenantId: string, permissions: Permission[]): Actor {
  return { userId: randomUUID(), tenantId, employeeId: null, permissions: new Set(permissions), mfaVerified: false };
}

async function roleId(tenantId: string, key: string): Promise<string> {
  return withTenant(db, tenantId, async (tx) => {
    const [found] = await tx.select({ id: role.id }).from(role).where(eq(role.key, key));
    return found!.id;
  });
}

async function signUp(companyName: string, owner: string): Promise<{ tenantId: string; userId: string }> {
  const created = await new TenantService(db, new AuditService(db)).signup({
    companyName, adminEmail: owner, adminPassword: PASSWORD, adminFirstName: 'Owner',
  });
  tenants.push(created.tenantId);
  return created;
}

/** The roles a login holds in one company, by key. */
async function rolesHeld(tenantId: string, userId: string): Promise<string[]> {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx.select({ key: role.key }).from(userRole)
      .innerJoin(role, eq(role.id, userRole.roleId))
      .where(eq(userRole.userId, userId));
    return rows.map((r) => r.key).sort();
  });
}

async function userIdFor(address: string): Promise<string | undefined> {
  const [found] = await db.select({ id: user.id }).from(user).where(eq(user.email, address));
  return found?.id;
}

async function rejection(attempt: Promise<unknown>): Promise<unknown> {
  return attempt.then(() => { throw new Error('expected a rejection'); }, (e: unknown) => e);
}

/** Someone invited in and accepted, the real way. */
async function joined(name: string, roleKeys: string[], inviter: Actor = acmeOwner): Promise<string> {
  const address = email(name);
  const roleIds = await Promise.all(roleKeys.map((key) => roleId(inviter.tenantId, key)));
  const { token } = await service.invite(inviter, { email: address, roleIds });
  await service.acceptInvitation(token, PASSWORD);
  return (await userIdFor(address))!;
}

/** A real member, acting with what those roles grant, past the MFA check. */
function actingAs(userId: string, tenantId: string, ...roleKeys: string[]): Actor {
  return {
    userId, tenantId, employeeId: null, permissions: new Set(roleKeys.flatMap(permissionsOf)), mfaVerified: true,
  };
}

/** The access token a member would present: what AuthGuard hands resolveActor. */
function tokenFor(userId: string, tenantId: string): JwtPayload {
  return { sub: userId, tid: tenantId, eid: null, mfa: false, typ: 'access' };
}

async function memberEmails(actor: Actor): Promise<string[]> {
  return (await service.listAccess(actor)).members.map((m) => m.email);
}

async function audited(tenantId: string, userId: string, action: string) {
  return withTenant(db, tenantId, (tx) => tx.select().from(auditLog)
    .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, userId), eq(auditLog.action, action))));
}

beforeAll(async () => {
  if (!TEST_DB_URL) return;

  db = getDb(TEST_DB_URL);
  await assertRlsEnforced(db);

  jwt = new JwtService();
  auth = new AuthService(db, jwt, config, new PiiService(config), new AuditService(db));
  service = new UserService(db, new AuditService(db));

  const a = await signUp('Acme Textiles', email('acme-owner'));
  const g = await signUp('Globex Motors', email('globex-owner'));
  acme = a.tenantId;
  globex = g.tenantId;

  acmeOwner = { ...actorIn(acme, ALL_PERMISSIONS), userId: a.userId };
  acmeHr = actorIn(acme, permissionsOf('HR_ADMIN'));
  globexOwner = { ...actorIn(globex, ALL_PERMISSIONS), userId: g.userId };
});

afterAll(async () => {
  if (!db) return;
  for (const id of tenants) {
    await withPurgeMode(db, id, 'user-invitation test teardown', (tx) =>
      tx.delete(tenant).where(eq(tenant.id, id)));
  }
  if (emails.length > 0) await db.delete(user).where(inArray(user.email, emails));
  await closeDb();
});

describeIfDb('inviting a user', () => {
  it('offers, and allows, only roles whose every permission the inviter holds', async () => {
    const offered = (await service.grantableRoles(acmeHr)).map((r) => r.name);
    expect(offered).toContain('Manager');
    expect(offered).toContain('HR Admin');
    // HR Admin cannot see pay, so cannot hand out a role that can.
    expect(offered).not.toContain('Payroll Admin');
    expect(offered).not.toContain('Accountant (external)');
    expect(offered).not.toContain('Super Admin');

    const payroll = await roleId(acme, 'PAYROLL_ADMIN');
    const refused = await rejection(service.invite(acmeHr, { email: email('escalate'), roleIds: [payroll] }));
    expect(refused).toBeInstanceOf(ForbiddenException);
  });

  it('refuses a role id belonging to another company', async () => {
    const globexManager = await roleId(globex, 'MANAGER');
    const refused = await rejection(service.invite(acmeOwner, { email: email('foreign-role'), roleIds: [globexManager] }));
    expect(refused).toBeInstanceOf(BadRequestException);
  });

  it('refuses someone who can already sign in here', async () => {
    const manager = await roleId(acme, 'MANAGER');
    const refused = await rejection(service.invite(acmeOwner, { email: emails[0]!, roleIds: [manager] }));
    expect(refused).toBeInstanceOf(ConflictException);
  });

  it('creates a login holding exactly the invited roles, signed in to the inviting company', async () => {
    const address = email('new-hr');
    const { token } = await service.invite(acmeOwner, { email: address, roleIds: [await roleId(acme, 'HR_ADMIN')] });

    const preview = await service.previewInvitation(token);
    expect(preview).toMatchObject({ email: address, companyName: 'Acme Textiles', roles: ['HR Admin'], hasAccount: false });

    const accepted = await service.acceptInvitation(token, PASSWORD);
    expect(accepted).toEqual({ email: address, tenantId: acme });

    const userId = (await userIdFor(address))!;
    expect(await rolesHeld(acme, userId)).toEqual(['HR_ADMIN']);

    const session = await auth.login(address, PASSWORD);
    const payload = jwt.verify<JwtPayload>(session.accessToken, { secret: SECRETS['JWT_ACCESS_SECRET']! });
    expect(payload.tid).toBe(acme);
    expect(payload.eid).toBeNull();
  });

  it('is a single-use link', async () => {
    const address = email('once');
    const { token } = await service.invite(acmeOwner, { email: address, roleIds: [await roleId(acme, 'EMPLOYEE')] });
    await service.acceptInvitation(token, PASSWORD);

    expect(await rejection(service.acceptInvitation(token, PASSWORD))).toBeInstanceOf(GoneException);
    expect(await rejection(service.previewInvitation(token))).toBeInstanceOf(GoneException);
  });

  it('makes a second accept of the same link wait for the first, then refuses it', async () => {
    const address = email('race');
    const { token, invitation } = await service.invite(acmeOwner, {
      email: address, roleIds: [await roleId(acme, 'EMPLOYEE')],
    });

    // Two Promise.all'd accepts do not race here: the second opens a fresh pool
    // connection and arrives after the first has committed, lock or no lock. So
    // the first accept is staged by hand — holding the row, about to mark it used.
    let release!: () => void;
    let holding!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const held = new Promise<void>((resolve) => { holding = resolve; });

    const first = withTenant(db, acme, async (tx) => {
      await tx.select().from(userInvitation).where(eq(userInvitation.id, invitation.id)).for('update');
      holding();
      await released;
      await tx.update(userInvitation).set({ acceptedAt: new Date() }).where(eq(userInvitation.id, invitation.id));
    });

    await held;
    const second = service.acceptInvitation(token, PASSWORD);
    // Long enough for `second` to reach its read. Were it slower, it would read
    // the committed row and pass for the wrong reason — never fail for one.
    await new Promise((resolve) => setTimeout(resolve, 250));
    release();
    await first;

    // Without the lock, `second` reads the row as still live, creates the login,
    // and its own UPDATE simply queues behind the first: both succeed.
    expect(await rejection(second)).toBeInstanceOf(GoneException);
    expect(await userIdFor(address)).toBeUndefined();
  });

  it('finds nothing when the token is presented with another company\'s id', async () => {
    const { token } = await service.invite(acmeOwner, { email: email('cross'), roleIds: [await roleId(acme, 'EMPLOYEE')] });
    const secret = token.split('.')[1]!;

    // Under Globex's context, Acme's invitation row is invisible to RLS.
    expect(await rejection(service.previewInvitation(`${globex}.${secret}`))).toBeInstanceOf(NotFoundException);
    expect(await rejection(service.acceptInvitation(`${globex}.${secret}`, PASSWORD))).toBeInstanceOf(NotFoundException);
    expect(await rejection(service.previewInvitation('not-a-token'))).toBeInstanceOf(NotFoundException);
  });

  it('keeps one live link per address: inviting again kills the old one', async () => {
    const address = email('reinvite');
    const first = await service.invite(acmeOwner, { email: address, roleIds: [await roleId(acme, 'HR_ADMIN')] });
    const second = await service.invite(acmeOwner, { email: address, roleIds: [await roleId(acme, 'EMPLOYEE')] });

    expect(await rejection(service.acceptInvitation(first.token, PASSWORD))).toBeInstanceOf(NotFoundException);
    await service.acceptInvitation(second.token, PASSWORD);
    expect(await rolesHeld(acme, (await userIdFor(address))!)).toEqual(['EMPLOYEE']);
  });

  it('stops working once revoked or expired', async () => {
    const employee = await roleId(acme, 'EMPLOYEE');

    const revoked = await service.invite(acmeOwner, { email: email('revoked'), roleIds: [employee] });
    await service.revokeInvitation(acmeOwner, revoked.invitation.id);
    expect(await rejection(service.acceptInvitation(revoked.token, PASSWORD))).toBeInstanceOf(NotFoundException);

    const expired = await service.invite(acmeOwner, { email: email('expired'), roleIds: [employee] });
    await withTenant(db, acme, (tx) => tx.update(userInvitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(userInvitation.id, expired.invitation.id)));
    expect(await rejection(service.acceptInvitation(expired.token, PASSWORD))).toBeInstanceOf(GoneException);
  });

  it('refuses a short password for a new login, and creates nothing', async () => {
    const address = email('weak');
    const { token } = await service.invite(acmeOwner, { email: address, roleIds: [await roleId(acme, 'EMPLOYEE')] });

    expect(await rejection(service.acceptInvitation(token, 'hunter2'))).toBeInstanceOf(BadRequestException);
    expect(await userIdFor(address)).toBeUndefined();
  });
});

describeIfDb('inviting someone who already has a login (the CA firm)', () => {
  let accountant: string;
  let accountantId: string;

  beforeAll(async () => {
    if (!TEST_DB_URL) return;
    // Already an accountant at Globex.
    accountant = email('ca');
    const { token } = await service.invite(globexOwner, {
      email: accountant, roleIds: [await roleId(globex, 'ACCOUNTANT')],
    });
    await service.acceptInvitation(token, PASSWORD);
    accountantId = (await userIdFor(accountant))!;
  });

  it('will not attach the account without its password', async () => {
    const { token } = await service.invite(acmeOwner, {
      email: accountant, roleIds: [await roleId(acme, 'ACCOUNTANT')],
    });

    const preview = await service.previewInvitation(token);
    expect(preview.hasAccount).toBe(true);

    // Whoever holds the link chose this. Were it accepted, they would own the login.
    expect(await rejection(service.acceptInvitation(token, 'a brand new password of mine')))
      .toBeInstanceOf(BadRequestException);
    expect((await auth.listTenants(accountantId)).map((t) => t.id)).toEqual([globex]);
  });

  it('attaches it with the password, leaving the other company untouched', async () => {
    const { token } = await service.invite(acmeOwner, {
      email: accountant, roleIds: [await roleId(acme, 'ACCOUNTANT')],
    });
    await service.acceptInvitation(token, PASSWORD);

    expect((await auth.listTenants(accountantId)).map((t) => t.id).sort()).toEqual([acme, globex].sort());
    expect(await rolesHeld(acme, accountantId)).toEqual(['ACCOUNTANT']);
    expect(await rolesHeld(globex, accountantId)).toEqual(['ACCOUNTANT']);

    const switched = await auth.switchTenant(accountantId, acme);
    expect(switched.activeTenant.id).toBe(acme);
  });

  it('records the acceptance against the invitee, not the inviter', async () => {
    const rows = await withTenant(db, acme, (tx) => tx.select().from(auditLog)
      .where(and(eq(auditLog.action, 'ACCEPT'), eq(auditLog.actorUserId, accountantId))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after).toMatchObject({ newAccount: false, roles: ['Accountant (external)'] });
  });
});

describeIfDb('coming back after being removed', () => {
  it('grants what the new invitation says, not what was held before', async () => {
    const address = email('returning');
    const first = await service.invite(acmeOwner, { email: address, roleIds: [await roleId(acme, 'HR_ADMIN')] });
    await service.acceptInvitation(first.token, PASSWORD);
    const userId = (await userIdFor(address))!;

    await service.remove(acmeOwner, userId);

    const again = await service.invite(acmeOwner, { email: address, roleIds: [await roleId(acme, 'EMPLOYEE')] });
    await service.acceptInvitation(again.token, PASSWORD);

    expect(await rolesHeld(acme, userId)).toEqual(['EMPLOYEE']);
    expect(await auth.resolveActor(tokenFor(userId, acme))).toMatchObject({ userId, tenantId: acme });
  });

  it('also clears roles left on file by a membership switched off by hand', async () => {
    const address = email('returning-legacy');
    const first = await service.invite(acmeOwner, { email: address, roleIds: [await roleId(acme, 'HR_ADMIN')] });
    await service.acceptInvitation(first.token, PASSWORD);
    const userId = (await userIdFor(address))!;

    // What removal looked like before it deleted roles: membership off, roles still there.
    await db.update(userTenant).set({ isActive: false })
      .where(and(eq(userTenant.userId, userId), eq(userTenant.tenantId, acme)));

    const again = await service.invite(acmeOwner, { email: address, roleIds: [await roleId(acme, 'EMPLOYEE')] });
    await service.acceptInvitation(again.token, PASSWORD);

    expect(await rolesHeld(acme, userId)).toEqual(['EMPLOYEE']);
  });
});

/**
 * `user.manage`: changing what someone can do, and ending it.
 *
 * The danger is not a stranger — the guard keeps them out — but an admin
 * reaching past their own access: removing whoever could stop them, promoting a
 * friend above themselves, leaving a link behind on the way out.
 */
describeIfDb('removing someone', () => {
  it('ends the membership and the roles, and the token they hold stops working', async () => {
    const leaver = await joined('leaver', ['HR_ADMIN']);
    expect(await auth.resolveActor(tokenFor(leaver, acme))).toMatchObject({ userId: leaver });

    await service.remove(acmeOwner, leaver);

    expect(await memberEmails(acmeOwner)).not.toContain(emails.at(-1));
    expect(await rolesHeld(acme, leaver)).toEqual([]);
    expect(await auth.listTenants(leaver)).toEqual([]);
    // Not merely "no permissions": routes that need none must refuse too.
    expect(await rejection(auth.resolveActor(tokenFor(leaver, acme)))).toBeInstanceOf(UnauthorizedException);
    expect(await rejection(auth.login(emails.at(-1)!, PASSWORD))).toBeInstanceOf(UnauthorizedException);

    const [entry] = await audited(acme, leaver, 'REMOVE');
    expect(entry!.actorUserId).toBe(acmeOwner.userId);
    expect(entry!.before).toMatchObject({ roles: ['HR Admin'] });
  });

  it('kills the invitations they sent, so they cannot let themselves back in', async () => {
    const leaver = await joined('leaver-with-link', ['HR_ADMIN']);
    const backdoor = await service.invite(actingAs(leaver, acme, 'HR_ADMIN'), {
      email: email('second-address'), roleIds: [await roleId(acme, 'HR_ADMIN')],
    });

    await service.remove(acmeOwner, leaver);

    expect(await rejection(service.acceptInvitation(backdoor.token, PASSWORD))).toBeInstanceOf(NotFoundException);
    const [entry] = await audited(acme, leaver, 'REMOVE');
    expect(entry!.after).toEqual({ revokedInvitations: [backdoor.invitation.id] });
  });

  it('refuses a token for a login that has been disabled', async () => {
    const disabled = await joined('disabled', ['EMPLOYEE']);
    await db.update(user).set({ isActive: false }).where(eq(user.id, disabled));

    expect(await rejection(auth.resolveActor(tokenFor(disabled, acme)))).toBeInstanceOf(UnauthorizedException);
  });
});

describeIfDb('what an admin may change', () => {
  let hr: string;
  let hrActor: Actor;

  beforeAll(async () => {
    if (!TEST_DB_URL) return;
    hr = await joined('hr-admin', ['HR_ADMIN']);
    hrActor = actingAs(hr, acme, 'HR_ADMIN');
  });

  it('never their own access', async () => {
    const self = acmeOwner.userId;
    expect(await rejection(service.remove(acmeOwner, self))).toBeInstanceOf(ForbiddenException);
    expect(await rejection(service.updateRoles(acmeOwner, self, { roleIds: [await roleId(acme, 'EMPLOYEE')] })))
      .toBeInstanceOf(ForbiddenException);
    expect(await rejection(service.resetMfa(acmeOwner, self))).toBeInstanceOf(ForbiddenException);
    expect(await rolesHeld(acme, self)).toEqual(['SUPER_ADMIN']);
  });

  it('nobody who can do something they cannot', async () => {
    const payroll = await joined('payroll-admin', ['PAYROLL_ADMIN']);

    // HR Admin cannot see pay. Removing whoever can, or the owner, is out of reach.
    expect(await rejection(service.remove(hrActor, payroll))).toBeInstanceOf(ForbiddenException);
    expect(await rejection(service.remove(hrActor, acmeOwner.userId))).toBeInstanceOf(ForbiddenException);
    expect(await rejection(service.resetMfa(hrActor, payroll))).toBeInstanceOf(ForbiddenException);
    expect(await rolesHeld(acme, payroll)).toEqual(['PAYROLL_ADMIN']);

    const { members } = await service.listAccess(hrActor);
    expect(members.find((m) => m.userId === payroll)!.manageable).toBe(false);
    expect(members.find((m) => m.userId === hr)!.manageable).toBe(false);

    // A Manager holds nothing HR Admin lacks.
    const manager = await joined('manager', ['MANAGER']);
    expect((await service.listAccess(hrActor)).members.find((m) => m.userId === manager)!.manageable).toBe(true);
    await service.remove(hrActor, manager);
    expect(await rolesHeld(acme, manager)).toEqual([]);
  });

  it('no login outside their company', async () => {
    const foreign = globexOwner.userId;
    expect(await rejection(service.remove(acmeOwner, foreign))).toBeInstanceOf(NotFoundException);
    expect(await rejection(service.resetMfa(acmeOwner, foreign))).toBeInstanceOf(NotFoundException);
    expect(await rejection(service.updateRoles(acmeOwner, foreign, { roleIds: [await roleId(acme, 'EMPLOYEE')] })))
      .toBeInstanceOf(NotFoundException);
    expect(await auth.listTenants(foreign)).toHaveLength(1);
  });

  it('roles only within what they could grant', async () => {
    const target = await joined('promoted', ['EMPLOYEE']);

    expect(await rejection(service.updateRoles(hrActor, target, { roleIds: [await roleId(acme, 'PAYROLL_ADMIN')] })))
      .toBeInstanceOf(ForbiddenException);
    expect(await rejection(service.updateRoles(hrActor, target, { roleIds: [await roleId(globex, 'MANAGER')] })))
      .toBeInstanceOf(BadRequestException);
    expect(await rolesHeld(acme, target)).toEqual(['EMPLOYEE']);

    await service.updateRoles(hrActor, target, { roleIds: [await roleId(acme, 'MANAGER')] });
    expect(await rolesHeld(acme, target)).toEqual(['MANAGER']);

    const [entry] = await audited(acme, target, 'ROLES_CHANGE');
    expect(entry!.before).toMatchObject({ roles: ['Employee'] });
    expect(entry!.after).toMatchObject({ roles: ['Manager'], revokedInvitations: [] });
  });

  it('kills the invitations a demoted member could no longer send, and only those', async () => {
    const demoted = await joined('demoted', ['HR_ADMIN']);
    const asDemoted = actingAs(demoted, acme, 'HR_ADMIN');
    const tooHigh = await service.invite(asDemoted, { email: email('too-high'), roleIds: [await roleId(acme, 'HR_ADMIN')] });
    const stillFine = await service.invite(asDemoted, { email: email('still-fine'), roleIds: [await roleId(acme, 'EMPLOYEE')] });

    await service.updateRoles(acmeOwner, demoted, { roleIds: [await roleId(acme, 'MANAGER')] });

    expect(await rejection(service.acceptInvitation(tooHigh.token, PASSWORD))).toBeInstanceOf(NotFoundException);
    await service.acceptInvitation(stillFine.token, PASSWORD);
  });

  it('re-reads their own access under a lock: two admins removing each other leave one', async () => {
    const a = await joined('mutual-a', ['HR_ADMIN']);
    const b = await joined('mutual-b', ['HR_ADMIN']);

    // A removes B, staged by hand so it is caught holding both memberships —
    // the locks remove() takes — at the moment B tries to remove A.
    let release!: () => void;
    let holding!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const held = new Promise<void>((resolve) => { holding = resolve; });

    const first = withTenant(db, acme, async (tx) => {
      await tx.select().from(userTenant)
        .where(and(eq(userTenant.tenantId, acme), inArray(userTenant.userId, [a, b])))
        .orderBy(asc(userTenant.userId))
        .for('update');
      holding();
      await released;
      await tx.update(userTenant).set({ isActive: false })
        .where(and(eq(userTenant.userId, b), eq(userTenant.tenantId, acme)));
      await tx.delete(userRole).where(and(eq(userRole.userId, b), eq(userRole.tenantId, acme)));
    });

    await held;
    // B's request was authorized before A's removal committed, so B's actor
    // still says HR Admin. Without the lock, B reads A as removable, waits only
    // at its own UPDATE, and removes A once A commits: nobody is left.
    const second = service.remove(actingAs(b, acme, 'HR_ADMIN'), a);
    await new Promise((resolve) => setTimeout(resolve, 250));
    release();
    await first;

    expect(await rejection(second)).toBeInstanceOf(ForbiddenException);
    expect(await rolesHeld(acme, a)).toEqual(['HR_ADMIN']);
  });
});

describeIfDb('resetting someone\'s two-factor', () => {
  async function enrol(userId: string): Promise<void> {
    await db.update(user).set({
      mfaSecret: 'encrypted-elsewhere',
      mfaEnabledAt: new Date(),
      mfaPendingSecret: 'a-replacement-in-progress',
      mfaRecoveryCodes: ['hash-of-a-code-they-may-have-lost'],
      mfaLastUsedStep: 1,
      mfaFailedAttempts: 3,
      mfaLockedUntil: new Date(Date.now() + 60_000),
    }).where(eq(user.id, userId));
  }

  it('switches it off, and they can set up a new authenticator', async () => {
    const lostPhone = await joined('lost-phone', ['PAYROLL_ADMIN']);
    await enrol(lostPhone);

    await service.resetMfa(acmeOwner, lostPhone);

    const [row] = await db.select().from(user).where(eq(user.id, lostPhone));
    expect(row).toMatchObject({
      mfaSecret: null, mfaEnabledAt: null, mfaPendingSecret: null, mfaRecoveryCodes: [],
      mfaLastUsedStep: null, mfaFailedAttempts: 0, mfaLockedUntil: null,
    });
    expect((await service.listAccess(acmeOwner)).members.find((m) => m.userId === lostPhone)!.mfaEnabled).toBe(false);

    // Enrolment refuses anyone with MFA on; it must now accept them.
    const enrolment = await auth.startMfaEnrolment(actingAs(lostPhone, acme, 'PAYROLL_ADMIN'));
    expect(enrolment.secret).toBeTruthy();

    const [entry] = await audited(acme, lostPhone, 'MFA_RESET');
    expect(entry!.actorUserId).toBe(acmeOwner.userId);
  });

  it('refuses a login that also signs in to another company', async () => {
    const address = email('two-companies');
    const there = await service.invite(globexOwner, { email: address, roleIds: [await roleId(globex, 'PAYROLL_ADMIN')] });
    await service.acceptInvitation(there.token, PASSWORD);
    const here = await service.invite(acmeOwner, { email: address, roleIds: [await roleId(acme, 'ACCOUNTANT')] });
    await service.acceptInvitation(here.token, PASSWORD);
    const shared = (await userIdFor(address))!;
    await enrol(shared);

    // Acme's admin would be switching off the factor that guards Globex's payroll.
    expect(await rejection(service.resetMfa(acmeOwner, shared))).toBeInstanceOf(ConflictException);
    const [row] = await db.select({ mfaEnabledAt: user.mfaEnabledAt }).from(user).where(eq(user.id, shared));
    expect(row!.mfaEnabledAt).not.toBeNull();
  });

  it('refuses when there is nothing to reset', async () => {
    const never = await joined('never-enrolled', ['EMPLOYEE']);
    expect(await rejection(service.resetMfa(acmeOwner, never))).toBeInstanceOf(ConflictException);
  });
});

describeIfDb('the access list', () => {
  it('shows this company\'s logins and invitations, and none of another\'s', async () => {
    const pendingHere = email('pending-acme');
    const pendingThere = email('pending-globex');
    await service.invite(acmeOwner, { email: pendingHere, roleIds: [await roleId(acme, 'EMPLOYEE')] });
    await service.invite(globexOwner, { email: pendingThere, roleIds: [await roleId(globex, 'EMPLOYEE')] });

    const { members, invitations } = await service.listAccess(acmeOwner);
    const memberEmails = members.map((m) => m.email);
    const invitedEmails = invitations.map((i) => i.email);

    expect(memberEmails).toContain(emails[0]); // Acme's owner
    expect(memberEmails).not.toContain(emails[1]); // Globex's owner
    expect(invitedEmails).toContain(pendingHere);
    expect(invitedEmails).not.toContain(pendingThere);
    expect(members.find((m) => m.email === emails[0])!.roles.map((r) => r.name)).toEqual(['Super Admin']);
  });
});
