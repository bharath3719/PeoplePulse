import { Injectable, Inject } from '@nestjs/common';
import { auditLog, type TenantDatabase } from '@peoplepulse/db';
import type { Actor } from '@peoplepulse/core';
import { DB } from '../database/database.module';
import type { Database } from '@peoplepulse/db';

/**
 * Fields that must NEVER reach the audit log.
 *
 * A log file is a data breach in waiting (BRD risk R4). We record THAT a salary
 * changed, who changed it, and when — not what it changed to. The value lives
 * in the versioned salary structure, behind `employee.salary.view`; the audit
 * trail is about accountability, not a second copy of the payroll.
 */
const NEVER_LOG = new Set([
  'passwordHash', 'mfaSecret',
  'panEncrypted', 'bankAccountEncrypted',
  'ctcAnnualPaise', 'basicPaise', 'grossPaise', 'netPayPaise',
]);

function scrub(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    // Present, so the reader knows the field changed — but never the value.
    out[k] = NEVER_LOG.has(k) ? '[redacted]' : v;
  }
  return out;
}

export interface AuditEntry {
  entity: string;
  entityId?: string | null;
  action: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Write an audit entry INSIDE the caller's transaction.
   *
   * This matters more than it looks. If the audit write were a separate
   * transaction, a change could commit while its audit entry rolled back — and
   * we would have an untraceable modification to payroll data. Passing the `tx`
   * makes the record and its evidence atomic: both, or neither.
   *
   * The table is append-only at the database level: the app role holds no
   * UPDATE or DELETE grant, and a trigger refuses them anyway (NFR-08).
   */
  async record(tx: TenantDatabase, actor: Actor, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLog).values({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      action: entry.action,
      before: scrub(entry.before) ?? null,
      after: scrub(entry.after) ?? null,
      ipAddress: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    });
  }

  /**
   * Record a decryption of PII (TR-52).
   *
   * Reading someone's PAN or bank account is an event worth knowing about, even
   * when it is authorized. Grep-able answer to "who looked at that?".
   */
  async recordPiiAccess(
    tx: TenantDatabase, actor: Actor, employeeId: string, fields: readonly string[],
  ): Promise<void> {
    await this.record(tx, actor, {
      entity: 'employee',
      entityId: employeeId,
      action: 'DECRYPT_PII',
      after: { fields: [...fields] },
    });
  }
}
