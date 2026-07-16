import {
  pgTable, uuid, text, boolean, timestamp, primaryKey, index, unique,
} from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

/**
 * A login. GLOBAL, not tenant-scoped — email is unique across the whole
 * platform.
 *
 * This is deliberate (D-16). An external accountant at a CA firm may serve
 * several of our customer companies, and BRD risk R3 names the CA-partner
 * channel as a core route to market. Making them hold one login per client is
 * friction in exactly the channel we are counting on to sell.
 *
 * Most users belong to exactly one company. They pay nothing for this.
 */
export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  phone: text('phone'),

  /** Argon2id (TR-50). Never bcrypt, never a fast hash. */
  passwordHash: text('password_hash').notNull(),

  /** TOTP shared secret, encrypted at rest. Null until MFA is enrolled. */
  mfaSecret: text('mfa_secret'),
  mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),

  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Which companies a user belongs to. The company switcher reads this.
 *
 * The JWT names ONE active tenant. RLS still sees exactly one tenant per
 * request, so multi-company membership does not weaken isolation by one inch —
 * it is a login-time concern, not a data-layer one.
 */
export const userTenant = pgTable('user_tenant', {
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),

  /**
   * The employee this login belongs to, if any.
   *
   * NULL for external users — an accountant has a login but no employee record
   * (BRD s5.2). Code that assumes every user is an employee will break on them,
   * which is why `Actor.employeeId` is nullable all the way up.
   *
   * Not a FK: `employee` is RLS-protected and this table is read during login,
   * before a tenant context exists. Integrity is enforced in the service layer.
   */
  employeeId: uuid('employee_id'),

  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.tenantId] }),
  index('user_tenant_tenant_idx').on(t.tenantId),
]);

/**
 * A role is a BAG OF PERMISSIONS, and it is data.
 *
 * Per-tenant, so a company can create custom roles (ADM-01) without a deploy.
 * The six system roles are seeded into every tenant at provisioning (TR-02).
 *
 * Nothing in the codebase branches on `role.key`. There is a test that enforces
 * this mechanically (packages/core rbac.test.ts). Code checks permissions.
 */
export const role = pgTable('role', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),

  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),

  /** System roles cannot be deleted, or a tenant could lock itself out. */
  isSystem: boolean('is_system').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('role_tenant_key_uq').on(t.tenantId, t.key),
  index('role_tenant_idx').on(t.tenantId),
]);

/**
 * The grants. `permission` is a string key from the registry in
 * packages/core/src/rbac/permissions.ts — validated on write, so an unknown
 * permission can never be stored.
 *
 * Deliberately NOT a Postgres enum: adding a permission would then require a
 * migration, and permissions are added constantly during a build.
 */
export const rolePermission = pgTable('role_permission', {
  roleId: uuid('role_id').notNull().references(() => role.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  permission: text('permission').notNull(),
}, (t) => [
  primaryKey({ columns: [t.roleId, t.permission] }),
  index('role_permission_tenant_idx').on(t.tenantId),
]);

/** Which roles a user holds in a given company. */
export const userRole = pgTable('user_role', {
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => role.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.roleId] }),
  index('user_role_tenant_idx').on(t.tenantId),
]);

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Role = typeof role.$inferSelect;
export type UserTenant = typeof userTenant.$inferSelect;
