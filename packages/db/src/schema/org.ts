import {
  pgTable, uuid, text, integer, doublePrecision, timestamp, index, unique,
} from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

/**
 * Org structure (CHR-02): location -> department -> designation -> grade.
 *
 * All four are RLS-protected and tenant-scoped.
 */

export const location = pgTable('location', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),

  name: text('name').notNull(),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),

  /**
   * The state drives Professional Tax and LWF (BRD s10). V1 supports
   * KARNATAKA only (D-15) — but the column is free text, not an enum, because
   * adding a state must be a data exercise, not a migration (NFR-12).
   *
   * Karnataka levies nil PT below ~Rs 25,000/month. A zero PT deduction is a
   * CORRECT, supported outcome here, not an unconfigured one.
   */
  state: text('state').notNull(),
  pincode: text('pincode'),

  // Geo-fence for mobile punch (ATT-01). Not money, so float is fine —
  // a few centimetres of drift on a 200-metre radius is nothing.
  geoLat: doublePrecision('geo_lat'),
  geoLng: doublePrecision('geo_lng'),
  geoRadiusMeters: integer('geo_radius_meters'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('location_tenant_idx').on(t.tenantId),
  unique('location_tenant_name_uq').on(t.tenantId, t.name),
]);

export const department = pgTable('department', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  code: text('code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('department_tenant_idx').on(t.tenantId),
  unique('department_tenant_name_uq').on(t.tenantId, t.name),
]);

export const designation = pgTable('designation', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('designation_tenant_idx').on(t.tenantId),
  unique('designation_tenant_name_uq').on(t.tenantId, t.name),
]);

export const grade = pgTable('grade', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** For sorting and for grade-based policy rules later. */
  level: integer('level'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('grade_tenant_idx').on(t.tenantId),
  unique('grade_tenant_name_uq').on(t.tenantId, t.name),
]);

export type Location = typeof location.$inferSelect;
export type Department = typeof department.$inferSelect;
export type Designation = typeof designation.$inferSelect;
export type Grade = typeof grade.$inferSelect;
