import { describe, it, expect } from 'vitest';
import type { Actor, Permission } from '@peoplepulse/core';
import { redact, redactMany, maskTail, unwritableFields, type FieldPolicy } from './redact';

/**
 * Field-level redaction (ADM-01).
 *
 * This is the last thing between a user without `employee.salary.view` and
 * somebody's salary. The tests below try to GET AT the sensitive fields rather
 * than confirming the happy path — a test that only checks an HR admin can see
 * a salary proves nothing about the person who shouldn't.
 */

function actor(...permissions: Permission[]): Actor {
  return {
    userId: 'u1',
    tenantId: 't1',
    employeeId: 'e1',
    permissions: new Set(permissions),
    mfaVerified: false,
  };
}

interface Row extends Record<string, unknown> {
  id: string;
  firstName: string;
  panMasked: string | null;
  salaryRupees: number | null;
}

const POLICY: FieldPolicy<Row> = {
  panMasked: 'employee.identifiers.view',
  salaryRupees: 'employee.salary.view',
};

const ROW: Row = {
  id: 'emp-1',
  firstName: 'Ravi',
  panMasked: 'XXXXXX234F',
  salaryRupees: 85_000,
};

describe('redact', () => {
  it('omits every field the actor lacks the permission for', () => {
    const view = redact(actor('employee.view'), ROW, POLICY);

    expect(view).toEqual({ id: 'emp-1', firstName: 'Ravi' });
  });

  it('REMOVES the field rather than nulling it', () => {
    const view = redact(actor('employee.view'), ROW, POLICY);

    // `salaryRupees: null` would still confirm the field exists. Over enough
    // endpoints that leaks the shape of the model. Absent must mean absent.
    expect('salaryRupees' in view).toBe(false);
    expect('panMasked' in view).toBe(false);
  });

  it('releases a field only to the exact permission that guards it', () => {
    // Holding the identifiers permission must NOT drag the salary along with it.
    const view = redact(actor('employee.view', 'employee.identifiers.view'), ROW, POLICY);

    expect(view.panMasked).toBe('XXXXXX234F');
    expect('salaryRupees' in view).toBe(false);
  });

  it('passes unguarded fields through untouched', () => {
    const view = redact(actor(), ROW, POLICY);

    expect(view.id).toBe('emp-1');
    expect(view.firstName).toBe('Ravi');
  });

  it('redacts every row in a list, not just the first', () => {
    const rows = [ROW, { ...ROW, id: 'emp-2', salaryRupees: 2_000_000 }];

    const views = redactMany(actor('employee.view'), rows, POLICY);

    expect(views).toHaveLength(2);
    for (const view of views) {
      expect('salaryRupees' in view).toBe(false);
    }
  });
});

describe('maskTail', () => {
  it('shows only the last four characters', () => {
    expect(maskTail('234F')).toBe('XXXXXX234F');
  });

  it('masks a bank account to its stored length', () => {
    expect(maskTail('6789', 12)).toBe('XXXXXXXX6789');
  });

  it('returns null when there is nothing stored — never the string "null"', () => {
    expect(maskTail(null)).toBeNull();
  });

  it('does not overflow the mask when the tail is longer than the width', () => {
    expect(maskTail('123456', 4)).toBe('123456');
  });
});

describe('unwritableFields — you may not overwrite what you may not read', () => {
  // An edit carries only the fields being changed, so the policy is over Partial<Row>.
  const EDIT_POLICY: FieldPolicy<Partial<Row>> = POLICY;

  it('names a sensitive field the caller cannot see', () => {
    const edit = { firstName: 'Ravi', salaryRupees: 1 };

    expect(unwritableFields(actor(), edit, EDIT_POLICY)).toEqual(['salaryRupees']);
  });

  it('flags a field that is present but null — clearing is writing', () => {
    // "I can't see it, so I'll just blank it" is still an edit to a salary.
    expect(unwritableFields(actor(), { panMasked: null }, EDIT_POLICY)).toEqual(['panMasked']);
  });

  it('lets through a caller who holds the permission', () => {
    const edit = { panMasked: 'XXXXXX234F', salaryRupees: 1 };
    const both = actor('employee.identifiers.view', 'employee.salary.view');

    expect(unwritableFields(both, edit, EDIT_POLICY)).toEqual([]);
  });

  it('ignores fields the policy does not mention', () => {
    expect(unwritableFields(actor(), { firstName: 'Ravi', id: 'x' }, EDIT_POLICY)).toEqual([]);
  });
});
