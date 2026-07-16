import { Injectable, Inject, ConflictException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  tenant, user, userTenant, role, rolePermission, userRole,
  withoutTenantIsolation, withTenant, type Database,
} from '@peoplepulse/db';
import { SYSTEM_ROLES, OWNER_ROLE_KEY, type Actor } from '@peoplepulse/core';
import { DB } from '../../platform/database/database.module';
import { AuthService } from '../../platform/auth/auth.service';
import { AuditService } from '../../platform/audit/audit.service';

export interface SignupInput {
  companyName: string;
  adminEmail: string;
  adminPassword: string;
  adminFirstName: string;
}

@Injectable()
export class TenantService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Self-serve signup (TR-02).
   *
   * Creates the company, seeds its roles, and makes the signer-up a Super Admin.
   * BRD NFR-09 targets a 30-minute self-serve setup; this is minute zero of it.
   *
   * NOTE what is NOT defaulted: `epfRegistered` and `esiRegistered` are FALSE.
   *
   * That is not laziness — it is ADR-004. EPF registration is mandatory only at
   * 20+ employees, and our segment starts at 10, so "not registered" is the
   * CORRECT and common state for a new SMB. Defaulting these to true would
   * deduct PF from every employee of a company that has no PF scheme, which is
   * exactly the Sev-1 that ADR-004 exists to prevent. HR turns them on
   * explicitly, in company settings, with their establishment code.
   */
  async signup(input: SignupInput): Promise<{ tenantId: string; userId: string }> {
    const email = input.adminEmail.toLowerCase().trim();
    const slug = slugify(input.companyName);

    return withoutTenantIsolation(this.db, 'signup: the tenant does not exist yet', async (db) => {
      const [existingUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
      if (existingUser) {
        // A user CAN belong to several companies (D-16) — but signup creates a
        // brand-new login. Joining an existing account to a new company is an
        // invitation flow, not this one.
        throw new ConflictException('An account with that email already exists');
      }

      const [existingSlug] = await db.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, slug));
      const finalSlug = existingSlug ? `${slug}-${randomSuffix()}` : slug;

      const passwordHash = await AuthService.hashPassword(input.adminPassword);

      return db.transaction(async (tx) => {
        // `tenant` and `user` are the only two tables outside RLS — they must
        // be, because neither a company nor a login can be looked up while
        // scoped to a company that does not exist yet.
        const [company] = await tx.insert(tenant)
          .values({ name: input.companyName.trim(), slug: finalSlug })
          .returning({ id: tenant.id });

        const [admin] = await tx.insert(user)
          .values({ email, passwordHash })
          .returning({ id: user.id });

        const tenantId = company!.id;
        const userId = admin!.id;

        /**
         * Everything from here on IS under RLS, so the context has to exist
         * before we can write a single row — including the rows that grant this
         * user access to the company we just created.
         *
         * RLS refused these inserts on the first run, and it was right to:
         * `user_tenant`, `role`, `role_permission` and `user_role` all carry a
         * WITH CHECK policy, and there was no tenant to check against. The
         * chicken-and-egg is resolved by setting the context mid-transaction,
         * the moment the tenant row exists.
         *
         * `is_local => true` keeps it scoped to this transaction, so it cannot
         * escape onto a pooled connection (ADR-005 D-2).
         */
        await tx.execute(sql`select set_config('app.current_tenant', ${tenantId}, true)`);

        await tx.insert(userTenant).values({ tenantId, userId, employeeId: null });

        /**
         * Seed the six system roles from the registry in packages/core.
         *
         * They are DATA, written per tenant — so a company can edit them, or add
         * custom roles, without a deploy (ADM-01). Nothing in the codebase
         * branches on a role name; there is a test that enforces that.
         */
        const seeded = await tx.insert(role).values(
          SYSTEM_ROLES.map((r) => ({
            tenantId, key: r.key, name: r.name, description: r.description, isSystem: true,
          })),
        ).returning({ id: role.id, key: role.key });

        const grants = SYSTEM_ROLES.flatMap((definition) => {
          const created = seeded.find((s) => s.key === definition.key)!;
          return definition.permissions.map((permission) => ({
            tenantId, roleId: created.id, permission,
          }));
        });
        await tx.insert(rolePermission).values(grants);

        // The person who signed up runs the company.
        //
        // OWNER_ROLE_KEY comes from the registry rather than being written here
        // as a literal. Provisioning is the one legitimate reason to name a role
        // at all, and even it does not get to hardcode the name — a test greps
        // the source tree for exactly that and fails the build.
        const owner = seeded.find((s) => s.key === OWNER_ROLE_KEY)!;
        await tx.insert(userRole).values({ tenantId, userId, roleId: owner.id });

        return { tenantId, userId };
      });
    });
  }

  async settings(tenantId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [found] = await tx.select().from(tenant).where(eq(tenant.id, tenantId));
      return found;
    });
  }

  /**
   * Turn EPF / ESI on or off for the company (ADR-004).
   *
   * NOTE what this does NOT do: retroactively change existing employees.
   *
   * `pfStatus` is decided at HIRE and stored. Registering for EPF today does not
   * silently enrol the 12 people already on the books — that is a deliberate
   * back-fill, with its own decisions to make about each person (do they have a
   * prior UAN? were they above the ceiling when they joined?). Quietly flipping
   * them all to MEMBER would start deducting PF from people who have not been
   * told, which is exactly the class of silent-wrong-number error BRD risk R1 is
   * about.
   *
   * The back-fill is a separate, explicit operation. Not this one.
   */
  async updateStatutory(actor: Actor, input: {
    epfRegistered?: boolean | undefined;
    epfEstablishmentCode?: string | undefined;
    epfRegisteredFrom?: string | undefined;
    esiRegistered?: boolean | undefined;
    esiEstablishmentCode?: string | undefined;
    esiRegisteredFrom?: string | undefined;
    pfRestrictToCeiling?: boolean | undefined;
  }) {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [before] = await tx.select().from(tenant).where(eq(tenant.id, actor.tenantId));

      const [updated] = await tx.update(tenant)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(tenant.id, actor.tenantId))
        .returning();

      await this.audit.record(tx, actor, {
        entity: 'tenant',
        entityId: actor.tenantId,
        action: 'UPDATE_STATUTORY',
        before: { epfRegistered: before?.epfRegistered, esiRegistered: before?.esiRegistered },
        after: input,
      });

      return updated;
    });
  }
}

function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'company';
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}
