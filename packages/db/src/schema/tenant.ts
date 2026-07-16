import {
  pgTable, uuid, text, boolean, date, timestamp, pgEnum, index,
} from 'drizzle-orm/pg-core';

export const tenantStatus = pgEnum('tenant_status', ['ACTIVE', 'SUSPENDED', 'CLOSED']);

/**
 * A customer company. The root of every tenant-owned row in the system.
 *
 * NOTE: `tenant` itself is NOT under row-level security — a user must be able
 * to resolve which tenants they belong to BEFORE a tenant context exists (the
 * company switcher, D-16). Access is gated by `user_tenant` instead.
 */
export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: tenantStatus('status').notNull().default('ACTIVE'),

  // --- Statutory registration (ADR-004) ---------------------------------
  //
  // These gate whether PF/ESI are computed AT ALL. They are set by HR during
  // onboarding and MUST NEVER be inferred from headcount: EPF registration is
  // mandatory at 20+ employees, but a smaller company may register voluntarily
  // (EPF Act s1(4)), and crossing 20 employees does not register you by magic.
  //
  // Our segment starts at 10 employees (BRD s2), so `false` here is a common,
  // correct state — not an unconfigured one. When false, no employee of this
  // company gets a PF line on their payslip. Not a zero line. No line.
  epfRegistered: boolean('epf_registered').notNull().default(false),
  epfEstablishmentCode: text('epf_establishment_code'),
  epfRegisteredFrom: date('epf_registered_from'),

  esiRegistered: boolean('esi_registered').notNull().default(false),
  esiEstablishmentCode: text('esi_establishment_code'),
  esiRegisteredFrom: date('esi_registered_from'),

  /**
   * PF ceiling election (OPEN.md D-10): restrict PF wage to the Rs 15,000
   * ceiling, or contribute on actual wage. Tenant-electable, defaults to
   * restrict — the common SMB choice.
   */
  pfRestrictToCeiling: boolean('pf_restrict_to_ceiling').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('tenant_status_idx').on(t.status),
]);

export type Tenant = typeof tenant.$inferSelect;
export type NewTenant = typeof tenant.$inferInsert;
