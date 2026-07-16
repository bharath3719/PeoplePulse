import {
  pgTable, uuid, text, timestamp, jsonb, index,
} from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

/**
 * The audit log (ADM-03, NFR-08). Write-only, forever.
 *
 * The migration REVOKEs UPDATE and DELETE on this table from the application
 * role. That is not belt-and-braces — statutory records must be retained for
 * >= 8 years and must be tamper-evident, and a log the application can rewrite
 * is not evidence of anything.
 *
 * If you need to correct an audit entry, you do not. You write another one.
 */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Cascades on tenant deletion — which is only ever reachable through purge
  // mode (account closure, ADM-05). Normal traffic cannot delete a tenant, and
  // the append-only trigger refuses these rows regardless.
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),

  /** Who. Null only for system actions (a scheduled accrual job). */
  actorUserId: uuid('actor_user_id'),
  actorEmail: text('actor_email'),

  /** What. e.g. 'employee', 'payroll_run', 'role'. */
  entity: text('entity').notNull(),
  entityId: uuid('entity_id'),

  /** e.g. 'CREATE', 'UPDATE', 'DELETE', 'FINALIZE', 'DECRYPT_PII', 'LOGIN'. */
  action: text('action').notNull(),

  /**
   * Old -> new. Both are redacted before writing: we never store a salary or a
   * PAN in the audit log itself. A log file is a data breach in waiting
   * (BRD risk R4). We record THAT the salary changed and by whom, not to what.
   */
  before: jsonb('before').$type<Record<string, unknown>>(),
  after: jsonb('after').$type<Record<string, unknown>>(),

  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),

  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('audit_tenant_at_idx').on(t.tenantId, t.at),
  index('audit_entity_idx').on(t.tenantId, t.entity, t.entityId),
  index('audit_actor_idx').on(t.tenantId, t.actorUserId),
]);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
