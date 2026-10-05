import type { Resolver } from 'react-hook-form';
import { updateEmployeeSchema } from '@peoplepulse/core';
import type { Employee } from './api/employees';

/**
 * The edit form, as the browser holds it: every input is a string (or the one
 * checkbox), and a blank box is ''. Turning that into a PATCH body is the job of
 * `toPatch` below.
 */
export interface EditFormValues {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  personalEmail: string;
  workEmail: string;
  phone: string;

  joinDate: string;
  employmentType: string;
  locationId: string;
  departmentId: string;
  designationId: string;
  gradeId: string;
  managerId: string;

  pan: string;
  uan: string;
  esicNumber: string;

  pfWageAtJoiningRupees: string;
  hasPriorPfMembership: boolean;
}

type Field = keyof EditFormValues;

/** Fields an employee cannot exist without. A blank here is an error, not a "clear". */
const REQUIRED: ReadonlySet<Field> = new Set(['firstName', 'joinDate', 'employmentType']);

export function toFormValues(employee: Employee): EditFormValues {
  return {
    firstName: employee.firstName,
    lastName: employee.lastName ?? '',
    dateOfBirth: employee.dateOfBirth ?? '',
    gender: employee.gender ?? '',
    personalEmail: employee.personalEmail ?? '',
    workEmail: employee.workEmail ?? '',
    phone: employee.phone ?? '',

    joinDate: employee.joinDate,
    employmentType: employee.employmentType,
    locationId: employee.locationId ?? '',
    departmentId: employee.departmentId ?? '',
    designationId: employee.designationId ?? '',
    gradeId: employee.gradeId ?? '',
    managerId: employee.managerId ?? '',

    // Never pre-filled: the profile only carries the masked PAN, and fetching
    // the real one is an audited decryption (TR-52) nobody asked for.
    pan: '',
    uan: employee.uan ?? '',
    esicNumber: employee.esicNumber ?? '',

    pfWageAtJoiningRupees:
      employee.pfJoiningWageRupees == null ? '' : String(employee.pfJoiningWageRupees),
    hasPriorPfMembership: employee.hasPriorPfMembership,
  };
}

/**
 * One form value as it goes over the wire, or `undefined` to leave it out.
 *
 * A blank means "clear it" (`null`) — except where it can't:
 *   - Required fields stay '', so the shared schema says what is wrong with
 *     them rather than "expected string, received null".
 *   - PAN starts blank because we never had it to show, so blank means "keep".
 */
function wireValue(field: Field, value: string | boolean): unknown {
  if (typeof value === 'boolean') return value;
  if (field === 'pan') return value === '' ? undefined : value;
  if (REQUIRED.has(field)) return value;
  if (value === '') return null;
  if (field === 'pfWageAtJoiningRupees') return Number(value);
  return value;
}

function toBody(values: EditFormValues, fields: readonly Field[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of fields) {
    const value = wireValue(field, values[field]);
    if (value !== undefined) body[field] = value;
  }
  return body;
}

/**
 * The PATCH body: only what the user actually changed.
 *
 * This is not an optimisation. A field the server redacted for this user
 * arrives absent and renders as a blank box; send the whole form back and that
 * blank becomes `null`, erasing a value they were never shown. It also keeps
 * the audit log to what the person meant to change.
 */
export function toPatch(
  values: EditFormValues,
  dirty: Partial<Record<Field, boolean | undefined>>,
): Record<string, unknown> {
  const changed = (Object.keys(dirty) as Field[]).filter((field) => dirty[field]);
  return toBody(values, changed);
}

/**
 * Validates the whole form with the API's own schema — the same rules, stated
 * once, in @peoplepulse/core. Hands back the raw form values: `toPatch` decides
 * what is sent.
 */
export const editResolver: Resolver<EditFormValues> = async (values) => {
  const parsed = updateEmployeeSchema.safeParse(toBody(values, Object.keys(values) as Field[]));
  if (parsed.success) return { values, errors: {} };

  const errors: Record<string, { type: string; message: string }> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.join('.');
    errors[path] ??= { type: issue.code, message: issue.message };
  }
  return { values: {}, errors: errors as never };
};
