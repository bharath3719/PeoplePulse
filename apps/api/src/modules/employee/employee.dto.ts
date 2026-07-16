import type { Actor } from '@peoplepulse/core';
import type { Employee } from '@peoplepulse/db';
import { redact, maskTail, type FieldPolicy } from '../../platform/rbac/redact';

/**
 * The request schemas now live in @peoplepulse/core (validation/employee.ts) so
 * that the web form and this endpoint validate against the SAME rules — they are
 * re-exported here because the controller and service import them from this
 * module, and because a DTO is where a reader looks for them.
 *
 * What stays here is the RESPONSE shape, which is API-only: it depends on the
 * redaction policy, and the browser has no business knowing how that works.
 */
export {
  createEmployeeSchema,
  updateEmployeeSchema,
  type CreateEmployeeInput,
  type UpdateEmployeeInput,
} from '@peoplepulse/core';

/**
 * What the client sees.
 *
 * Sensitive fields are declared here ONCE, with the permission each requires,
 * and stripped in the serializer. An endpoint author never writes an
 * authorization check for a field — they cannot forget to, because they were
 * never asked to remember. See ENGINEERING-STANDARDS.md §1.
 */
const FIELD_POLICY: FieldPolicy<EmployeeView> = {
  panMasked: 'employee.identifiers.view',
  uan: 'employee.identifiers.view',
  esicNumber: 'employee.identifiers.view',
  bankAccountMasked: 'employee.identifiers.view',
  bankIfsc: 'employee.identifiers.view',
  bankName: 'employee.identifiers.view',

  // PF status is not secret — it appears on the payslip — but the WAGE that
  // justified it is salary information.
  pfJoiningWageRupees: 'employee.salary.view',
};

export interface EmployeeView extends Record<string, unknown> {
  id: string;
  empCode: string;
  firstName: string;
  lastName: string | null;
  workEmail: string | null;
  phone: string | null;
  joinDate: string;
  status: string;
  employmentType: string;
  locationId: string | null;
  departmentId: string | null;
  designationId: string | null;
  managerId: string | null;

  pfStatus: string;
  esiStatus: string;

  panMasked: string | null;
  uan: string | null;
  esicNumber: string | null;
  bankAccountMasked: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  pfJoiningWageRupees: number | null;
}

/**
 * Note this never decrypts anything.
 *
 * The masked value is built from `panLast4`, which is stored in the clear
 * alongside the ciphertext precisely so a list of 200 employees performs ZERO
 * decryptions. Decrypting is an audited event (TR-52) — a list view must not
 * generate 200 audit entries, and must not need the key at all.
 */
export function toEmployeeView(actor: Actor, row: Employee): Partial<EmployeeView> {
  const view: EmployeeView = {
    id: row.id,
    empCode: row.empCode,
    firstName: row.firstName,
    lastName: row.lastName,
    workEmail: row.workEmail,
    phone: row.phone,
    joinDate: row.joinDate,
    status: row.status,
    employmentType: row.employmentType,
    locationId: row.locationId,
    departmentId: row.departmentId,
    designationId: row.designationId,
    managerId: row.managerId,

    pfStatus: row.pfStatus,
    esiStatus: row.esiStatus,

    panMasked: maskTail(row.panLast4, 10),
    uan: row.uan,
    esicNumber: row.esicNumber,
    bankAccountMasked: maskTail(row.bankAccountLast4, 12),
    bankIfsc: row.bankIfsc,
    bankName: row.bankName,
    pfJoiningWageRupees: row.pfJoiningWagePaise === null ? null : row.pfJoiningWagePaise / 100,
  };

  return redact(actor, view, FIELD_POLICY);
}
