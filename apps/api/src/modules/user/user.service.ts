import { createHash, randomBytes } from 'node:crypto';
import {
  Injectable, Inject, ConflictException, ForbiddenException, GoneException, NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import * as argon2 from 'argon2';
import {
  user, userTenant, userRole, role, rolePermission, userInvitation, tenant,
  withTenant, type Database, type TenantDatabase, type UserInvitation,
} from '@peoplepulse/db';
import {
  canGrant, isPermission, newPasswordSchema,
  type Actor, type InviteUserInput, type Permission, type UpdateMemberRolesInput,
} from '@peoplepulse/core';
import { DB } from '../../platform/database/database.module';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthService } from '../../platform/auth/auth.service';
import { validationFailed } from '../../platform/validation/zod.pipe';

/** Long enough to survive a weekend and a slow CA firm; short enough to go stale. */
const INVITATION_TTL_DAYS = 7;

export interface RoleOption { id: string; name: string; description: string | null }

export interface Member {
  userId: string;
  email: string;
  roles: { id: string; name: string }[];
  joinedAt: Date;
  /** Has an authenticator set up — what resetting two-factor would undo. */
  mfaEnabled: boolean;
  /**
   * The caller could change this member's access, given `user.manage`: someone
   * other than themselves, who can do nothing the caller cannot.
   */
  manageable: boolean;
}

type RoleWithPermissions = RoleOption & { permissions: Permission[] };

export interface PendingInvitation {
  id: string;
  email: string;
  roles: { id: string; name: string }[];
  invitedAt: Date;
  expiresAt: Date;
  expired: boolean;
}

export interface InvitationPreview {
  email: string;
  companyName: string;
  roles: string[];
  /** Decides the accept form: "enter your password" or "choose one". */
  hasAccount: boolean;
  expiresAt: Date;
}

/**
 * Who may sign in to a company, and how someone new gets to (D-16).
 *
 * There is no email delivery yet, so inviting returns the link and the inviter
 * sends it. That has one consequence worth stating: the link does not prove the
 * invitee owns the address. It cannot be used to take over an existing login —
 * accepting for an address that already has one requires that login's password
 * — but for a new address, whoever holds the link chooses the password. Email
 * delivery closes that, and needs no change here beyond who sends the link.
 */
@Injectable()
export class UserService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Everyone who can sign in to the actor's company, and everyone asked to. */
  async listAccess(actor: Actor): Promise<{ members: Member[]; invitations: PendingInvitation[] }> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const memberRows = await tx.select({
        userId: user.id, email: user.email, joinedAt: userTenant.createdAt, mfaEnabledAt: user.mfaEnabledAt,
      })
        .from(userTenant)
        .innerJoin(user, eq(user.id, userTenant.userId))
        // `user_tenant` and `user` sit outside RLS. This filter is the only
        // thing keeping another company's logins out of the list.
        .where(and(eq(userTenant.tenantId, actor.tenantId), eq(userTenant.isActive, true)))
        .orderBy(asc(user.email));

      const holdings = await tx.select({ userId: userRole.userId, roleId: userRole.roleId }).from(userRole);
      const roles = await this.rolesWithPermissions(tx);

      const pending = await tx.select().from(userInvitation)
        .where(and(isNull(userInvitation.acceptedAt), isNull(userInvitation.revokedAt)))
        .orderBy(desc(userInvitation.createdAt));

      const roleNames = new Map(roles.map((r) => [r.id, r.name]));
      const now = new Date();

      return {
        members: memberRows.map(({ mfaEnabledAt, ...m }) => {
          const held = rolesHeldBy(m.userId, holdings, roles);
          return {
            ...m,
            roles: held.map(({ id, name }) => ({ id, name })),
            mfaEnabled: Boolean(mfaEnabledAt),
            manageable: m.userId !== actor.userId && canGrant(actor, held.flatMap((r) => r.permissions)),
          };
        }),
        invitations: pending.map((i) => toPendingView(i, roleNames, now)),
      };
    });
  }

  /** The roles this actor may hand out: those holding nothing the actor lacks. */
  async grantableRoles(actor: Actor): Promise<RoleOption[]> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const roles = await this.rolesWithPermissions(tx);
      return roles
        .filter((r) => canGrant(actor, r.permissions))
        .map(({ id, name, description }) => ({ id, name, description }));
    });
  }

  /**
   * Invite someone, returning the token for the link. Shown once: only its hash
   * is kept.
   */
  async invite(actor: Actor, input: InviteUserInput): Promise<{ invitation: PendingInvitation; token: string }> {
    const roleIds = [...new Set(input.roleIds)];

    return withTenant(this.db, actor.tenantId, async (tx) => {
      const roles = (await this.rolesWithPermissions(tx)).filter((r) => roleIds.includes(r.id));
      if (roles.length !== roleIds.length) {
        // RLS hides other companies' roles, so a foreign id lands here too.
        throw validationFailed([{ field: 'roleIds', message: 'Unknown role' }]);
      }

      // The web form offers only grantable roles. This is what actually holds.
      if (!roles.every((r) => canGrant(actor, r.permissions))) {
        throw new ForbiddenException('You cannot grant access you do not hold yourself');
      }

      const [member] = await tx.select({ id: user.id }).from(user)
        .innerJoin(userTenant, and(
          eq(userTenant.userId, user.id),
          eq(userTenant.tenantId, actor.tenantId),
          eq(userTenant.isActive, true),
        ))
        .where(eq(user.email, input.email));
      if (member) {
        throw new ConflictException({
          title: 'Already a member',
          errors: [{ field: 'email', message: 'This person can already sign in to this company' }],
        });
      }

      // Inviting again replaces the live invitation: the old link stops working,
      // so it cannot outlive a change of mind about the roles.
      const replaced = await tx.update(userInvitation)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(userInvitation.email, input.email),
          isNull(userInvitation.acceptedAt),
          isNull(userInvitation.revokedAt),
        ))
        .returning({ id: userInvitation.id });

      const secret = randomBytes(32).toString('base64url');
      const now = new Date();
      const [created] = await tx.insert(userInvitation).values({
        tenantId: actor.tenantId,
        email: input.email,
        roleIds,
        tokenHash: hashSecret(secret),
        invitedByUserId: actor.userId,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
      }).returning();

      await this.audit.record(tx, actor, {
        entity: 'user_invitation',
        entityId: created!.id,
        action: 'INVITE',
        after: {
          email: input.email,
          roles: roles.map((r) => r.name),
          replaced: replaced.map((r) => r.id),
        },
      });

      return {
        invitation: toPendingView(created!, new Map(roles.map((r) => [r.id, r.name])), now),
        token: `${actor.tenantId}.${secret}`,
      };
    });
  }

  async revokeInvitation(actor: Actor, invitationId: string): Promise<void> {
    await withTenant(this.db, actor.tenantId, async (tx) => {
      const [revoked] = await tx.update(userInvitation)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(userInvitation.id, invitationId),
          isNull(userInvitation.acceptedAt),
          isNull(userInvitation.revokedAt),
        ))
        .returning({ email: userInvitation.email });
      if (!revoked) throw new NotFoundException('No pending invitation with that id');

      await this.audit.record(tx, actor, {
        entity: 'user_invitation', entityId: invitationId, action: 'REVOKE', after: { email: revoked.email },
      });
    });
  }

  /** What the accept page shows before anyone types a password. */
  async previewInvitation(token: string): Promise<InvitationPreview> {
    const { tenantId, secret } = parseToken(token);

    return withTenant(this.db, tenantId, async (tx) => {
      const invitation = await findLive(tx, secret);
      const [company] = await tx.select({ name: tenant.name }).from(tenant).where(eq(tenant.id, tenantId));
      const [account] = await tx.select({ id: user.id }).from(user).where(eq(user.email, invitation.email));
      const roleNames = await this.roleNames(tx);

      return {
        email: invitation.email,
        companyName: company!.name,
        roles: invitation.roleIds.flatMap((id) => roleNames.get(id) ?? []),
        // This tells the link holder whether the address has a login. So does
        // signup's "already exists"; the accept form cannot be right without it.
        hasAccount: Boolean(account),
        expiresAt: invitation.expiresAt,
      };
    });
  }

  /**
   * Accept: create the login, or attach an existing one, and grant the roles.
   *
   * One transaction, under the inviting company's context, with the invitation
   * row locked — two tabs accepting the same link cannot both succeed.
   *
   * Errors are 400/403/404/409/410, never 401. The web client reads any 401 as
   * an expired session and signs out, and someone already signed in to another
   * company may well be the one accepting.
   */
  async acceptInvitation(token: string, password: string): Promise<{ email: string; tenantId: string }> {
    const { tenantId, secret } = parseToken(token);

    return withTenant(this.db, tenantId, async (tx) => {
      const invitation = await findLive(tx, secret, { lock: true });
      const [account] = await tx.select().from(user).where(eq(user.email, invitation.email));

      let userId: string;
      if (account) {
        // Attaching an EXISTING login to a company: prove it is theirs. Without
        // this, inviting someone's address would hand their account to whoever
        // holds the link.
        const ok = await argon2.verify(account.passwordHash, password).catch(() => false);
        if (!ok) {
          throw validationFailed([{ field: 'password', message: 'That is not the password for this account' }]);
        }
        if (!account.isActive) throw new ForbiddenException('This account has been disabled');
        userId = account.id;
      } else {
        const strong = newPasswordSchema.safeParse(password);
        if (!strong.success) {
          throw validationFailed(strong.error.errors.map((e) => ({ field: 'password', message: e.message })));
        }
        const [created] = await tx.insert(user)
          .values({ email: invitation.email, passwordHash: await AuthService.hashPassword(password) })
          .returning({ id: user.id });
        userId = created!.id;
      }

      const [membership] = await tx.select().from(userTenant)
        .where(and(eq(userTenant.userId, userId), eq(userTenant.tenantId, tenantId)));
      if (membership?.isActive) {
        throw new ConflictException('You can already sign in to this company. Sign in instead.');
      }

      const roles = await tx.select({ id: role.id, name: role.name }).from(role)
        .where(inArray(role.id, invitation.roleIds));
      if (roles.length === 0) {
        throw new GoneException('The roles on this invitation no longer exist. Ask for a new one.');
      }

      if (membership) {
        // Back after being removed. The roles held then do not come back with
        // them; they get exactly what this invitation says.
        await tx.update(userTenant).set({ isActive: true })
          .where(and(eq(userTenant.userId, userId), eq(userTenant.tenantId, tenantId)));
        await tx.delete(userRole)
          .where(and(eq(userRole.userId, userId), eq(userRole.tenantId, tenantId)));
      } else {
        await tx.insert(userTenant).values({ userId, tenantId, employeeId: null });
      }

      await tx.insert(userRole).values(roles.map((r) => ({ userId, roleId: r.id, tenantId })));
      await tx.update(userInvitation)
        .set({ acceptedAt: new Date(), acceptedByUserId: userId })
        .where(eq(userInvitation.id, invitation.id));

      // The invitee is the actor: they did this, by accepting.
      const invitee: Actor = {
        userId, tenantId, employeeId: null, permissions: new Set(), mfaVerified: false,
      };
      await this.audit.record(tx, invitee, {
        entity: 'user_invitation',
        entityId: invitation.id,
        action: 'ACCEPT',
        after: { newAccount: !account, rejoined: Boolean(membership), roles: roles.map((r) => r.name) },
      });

      return { email: invitation.email, tenantId };
    });
  }

  /**
   * Replace what a member can do here. Bounded twice: the caller must be able to
   * do everything the member can now (see `lockForChange`), and everything the
   * new roles grant — the same `canGrant` rule as inviting, or demoting and
   * re-promoting would be a way round it.
   *
   * Invitations the member sent that grant more than they now hold stop
   * working. Otherwise demoting someone leaves them a week to accept their own
   * invitation, sent to a second address, at the old level.
   */
  async updateRoles(actor: Actor, userId: string, input: UpdateMemberRolesInput): Promise<void> {
    const roleIds = [...new Set(input.roleIds)];

    await withTenant(this.db, actor.tenantId, async (tx) => {
      const { self, member, roles, held } = await this.lockForChange(tx, actor, userId);

      const granting = roles.filter((r) => roleIds.includes(r.id));
      if (granting.length !== roleIds.length) {
        // RLS hides other companies' roles, so a foreign id lands here too.
        throw validationFailed([{ field: 'roleIds', message: 'Unknown role' }]);
      }
      if (!granting.every((r) => canGrant(self, r.permissions))) {
        throw new ForbiddenException('You cannot grant access you do not hold yourself');
      }

      const before = held.map((r) => r.id).sort();
      if (before.join() === [...roleIds].sort().join()) return;

      await tx.delete(userRole).where(and(eq(userRole.userId, userId), eq(userRole.tenantId, actor.tenantId)));
      await tx.insert(userRole).values(granting.map((r) => ({ userId, roleId: r.id, tenantId: actor.tenantId })));

      const nowHolds = new Set(granting.flatMap((r) => r.permissions));
      const revoked = await revokeInvitationsSentBy(tx, userId, (ids) =>
        roles.filter((r) => ids.includes(r.id)).every((r) => r.permissions.every((p) => nowHolds.has(p))));

      await this.audit.record(tx, actor, {
        entity: 'user',
        entityId: userId,
        action: 'ROLES_CHANGE',
        before: { email: member.email, roles: held.map((r) => r.name) },
        after: { roles: granting.map((r) => r.name), revokedInvitations: revoked },
      });
    });
  }

  /**
   * Take away someone's access to this company. Their login survives — it may
   * serve other companies (D-16) — and so does any employee record: this ends
   * the membership, not the employment.
   *
   * Three things go, in one transaction: the membership, every role held here,
   * and every invitation they sent that is still waiting. The roles go so that
   * coming back by invitation starts from nothing; the invitations, because a
   * removed admin must not be able to let themselves back in through a link
   * they sent before they left. Their current token stops working on its next
   * request (AuthService.resolveActor).
   */
  async remove(actor: Actor, userId: string): Promise<void> {
    await withTenant(this.db, actor.tenantId, async (tx) => {
      const { member, held } = await this.lockForChange(tx, actor, userId);

      await tx.update(userTenant).set({ isActive: false })
        .where(and(eq(userTenant.userId, userId), eq(userTenant.tenantId, actor.tenantId)));
      await tx.delete(userRole).where(and(eq(userRole.userId, userId), eq(userRole.tenantId, actor.tenantId)));
      const revoked = await revokeInvitationsSentBy(tx, userId, () => false);

      await this.audit.record(tx, actor, {
        entity: 'user',
        entityId: userId,
        action: 'REMOVE',
        before: { email: member.email, roles: held.map((r) => r.name) },
        after: { revokedInvitations: revoked },
      });
    });
  }

  /**
   * Switch off a member's two-factor authentication, for a lost or replaced
   * phone. Whoever next signs in with their password is offered setup, so the
   * person asking should be verified some way other than the password first —
   * the web form says so.
   *
   * Refused for a login that also belongs to another company. The second
   * factor belongs to the login, not the membership, so a reset here would
   * strip it from their access there too — on the say-so of an admin that
   * company never chose. That case needs a support process (D-18).
   */
  async resetMfa(actor: Actor, userId: string): Promise<void> {
    await withTenant(this.db, actor.tenantId, async (tx) => {
      const { member } = await this.lockForChange(tx, actor, userId);
      if (!member.mfaEnabledAt) {
        throw new ConflictException('This person has not set up two-factor authentication');
      }

      // `user_tenant` sits outside RLS, so this sees every company.
      const [elsewhere] = await tx.select({ tenantId: userTenant.tenantId }).from(userTenant)
        .where(and(
          eq(userTenant.userId, userId),
          eq(userTenant.isActive, true),
          ne(userTenant.tenantId, actor.tenantId),
        ))
        .limit(1);
      if (elsewhere) {
        throw new ConflictException(
          'This person signs in to another company with the same login, and their two-factor '
            + 'protects that company too. It cannot be reset from here.',
        );
      }

      await tx.update(user).set({
        mfaSecret: null,
        mfaEnabledAt: null,
        mfaLastUsedStep: null,
        mfaFailedAttempts: 0,
        mfaLockedUntil: null,
        updatedAt: new Date(),
      }).where(eq(user.id, userId));

      await this.audit.record(tx, actor, {
        entity: 'user', entityId: userId, action: 'MFA_RESET', after: { email: member.email },
      });
    });
  }

  /**
   * Everything a change to a member's access must establish first, under locks
   * held to the end of the caller's transaction.
   *
   * - Not yourself. Changing your own access here is how the last person who
   *   can manage access stops being able to. And because a member can be
   *   changed only by someone who holds everything they hold, the company can
   *   never lose its last holder of any permission this way.
   * - A member of THIS company. `user_tenant` sits outside RLS; the tenant
   *   filter below is all that keeps another company's logins out of reach.
   * - Holding nothing the caller does not: an HR Admin who cannot see pay must
   *   not be able to remove the Payroll Admin, or reset their second factor.
   *
   * Both memberships are locked, in a fixed order, and the caller's own access
   * is re-read under the lock rather than taken from the request. Otherwise two
   * admins removing each other at the same moment both pass on what they each
   * read, and both go.
   */
  private async lockForChange(tx: TenantDatabase, actor: Actor, userId: string) {
    if (userId === actor.userId) {
      throw new ForbiddenException('You cannot change your own access. Ask another administrator.');
    }

    const locked = await tx.select({
      userId: userTenant.userId, isActive: userTenant.isActive, email: user.email, mfaEnabledAt: user.mfaEnabledAt,
    })
      .from(userTenant)
      .innerJoin(user, eq(user.id, userTenant.userId))
      .where(and(eq(userTenant.tenantId, actor.tenantId), inArray(userTenant.userId, [actor.userId, userId])))
      .orderBy(asc(userTenant.userId))
      .for('update', { of: userTenant });

    if (!locked.find((m) => m.userId === actor.userId)?.isActive) {
      throw new ForbiddenException('You no longer have access to this company');
    }
    const member = locked.find((m) => m.userId === userId && m.isActive);
    if (!member) throw new NotFoundException('No one with that id can sign in to this company');

    const roles = await this.rolesWithPermissions(tx);
    const holdings = await tx.select({ userId: userRole.userId, roleId: userRole.roleId }).from(userRole)
      .where(inArray(userRole.userId, [actor.userId, userId]));

    const self: Actor = {
      ...actor,
      permissions: new Set(rolesHeldBy(actor.userId, holdings, roles).flatMap((r) => r.permissions)),
    };
    const held = rolesHeldBy(userId, holdings, roles);
    if (!canGrant(self, held.flatMap((r) => r.permissions))) {
      throw new ForbiddenException('You cannot change the access of someone who can do things you cannot');
    }

    return { self, member, roles, held };
  }

  private async rolesWithPermissions(tx: TenantDatabase): Promise<RoleWithPermissions[]> {
    const roles = await tx.select({ id: role.id, name: role.name, description: role.description })
      .from(role).orderBy(asc(role.name));
    const grants = await tx.select({ roleId: rolePermission.roleId, permission: rolePermission.permission })
      .from(rolePermission);

    return roles.map((r) => ({
      ...r,
      // A permission no longer in the registry grants nothing at runtime
      // (loadPermissions ignores it), so it does not count against granting.
      permissions: grants
        .filter((g) => g.roleId === r.id)
        .map((g) => g.permission)
        .filter((p): p is Permission => isPermission(p)),
    }));
  }

  private async roleNames(tx: TenantDatabase): Promise<Map<string, string>> {
    const rows = await tx.select({ id: role.id, name: role.name }).from(role);
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}

function rolesHeldBy(
  userId: string, holdings: { userId: string; roleId: string }[], roles: RoleWithPermissions[],
): RoleWithPermissions[] {
  return roles.filter((r) => holdings.some((h) => h.userId === userId && h.roleId === r.id));
}

/**
 * Revoke the still-pending invitations a member sent, except those `keep`
 * accepts by their role ids. Returns the ids revoked, for the audit entry.
 */
async function revokeInvitationsSentBy(
  tx: TenantDatabase, userId: string, keep: (roleIds: string[]) => boolean,
): Promise<string[]> {
  const pending = await tx.select({ id: userInvitation.id, roleIds: userInvitation.roleIds }).from(userInvitation)
    .where(and(
      eq(userInvitation.invitedByUserId, userId),
      isNull(userInvitation.acceptedAt),
      isNull(userInvitation.revokedAt),
    ));

  const revoke = pending.filter((i) => !keep(i.roleIds)).map((i) => i.id);
  if (revoke.length > 0) {
    await tx.update(userInvitation).set({ revokedAt: new Date() }).where(inArray(userInvitation.id, revoke));
  }
  return revoke;
}

function toPendingView(i: UserInvitation, roleNames: Map<string, string>, now: Date): PendingInvitation {
  return {
    id: i.id,
    email: i.email,
    roles: i.roleIds.flatMap((id) => {
      const name = roleNames.get(id);
      return name ? [{ id, name }] : [];
    }),
    invitedAt: i.createdAt,
    expiresAt: i.expiresAt,
    expired: i.expiresAt <= now,
  };
}

const tenantIdSchema = z.string().uuid();

/**
 * `<tenant id>.<secret>`. A malformed token is reported exactly like an unknown
 * one; and the tenant id must be checked before it reaches set_config, where a
 * non-uuid would surface as a 500 from the uuid cast in current_tenant_id().
 */
function parseToken(token: string): { tenantId: string; secret: string } {
  const [tenantId, secret, ...rest] = token.split('.');
  if (!tenantId || !secret || rest.length > 0 || !tenantIdSchema.safeParse(tenantId).success) {
    throw invalidLink();
  }
  return { tenantId, secret };
}

async function findLive(tx: TenantDatabase, secret: string, opts: { lock?: boolean } = {}): Promise<UserInvitation> {
  const query = tx.select().from(userInvitation).where(eq(userInvitation.tokenHash, hashSecret(secret)));
  const [found] = opts.lock ? await query.for('update') : await query;

  if (!found || found.revokedAt) throw invalidLink();
  if (found.acceptedAt) throw new GoneException('This invitation has already been used. Sign in instead.');
  if (found.expiresAt <= new Date()) {
    throw new GoneException('This invitation has expired. Ask whoever invited you for a new one.');
  }
  return found;
}

function invalidLink(): NotFoundException {
  return new NotFoundException('This invitation link is not valid. Ask whoever invited you for a new one.');
}

/**
 * A plain SHA-256, not Argon2. The secret is 256 random bits, so there is no
 * dictionary to slow down; what matters is that the stored value is not the
 * credential, and that lookup by it is an index hit.
 */
function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
