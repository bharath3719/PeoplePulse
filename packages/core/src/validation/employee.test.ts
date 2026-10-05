import { describe, it, expect } from 'vitest';
import { updateEmployeeSchema, updateEmployeeBankSchema } from './employee';

describe('updateEmployeeSchema — a correction, not a re-creation', () => {
  it('injects NO defaults: an edit to the name must not reset PF facts', () => {
    // The bug this schema exists to prevent. `createEmployeeSchema.partial()`
    // keeps the create defaults, so this body would come out carrying
    // `hasPriorPfMembership: false` — and the API would re-derive a prior PF
    // member as EXCLUDED because somebody fixed a typo in their name.
    const parsed = updateEmployeeSchema.parse({ firstName: 'Priya' });

    expect(parsed).toEqual({ firstName: 'Priya' });
    expect('hasPriorPfMembership' in parsed).toBe(false);
    expect('employmentType' in parsed).toBe(false);
  });

  it('tells "clear this" (null) apart from "leave it" (absent)', () => {
    const parsed = updateEmployeeSchema.parse({ workEmail: null, managerId: null });

    expect(parsed).toEqual({ workEmail: null, managerId: null });
    expect('phone' in parsed).toBe(false);
  });

  it('refuses to clear a field the employee cannot exist without', () => {
    expect(updateEmployeeSchema.safeParse({ firstName: null }).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({ joinDate: null }).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({ firstName: '' }).success).toBe(false);
  });

  it('applies the SAME identifier rules as create', () => {
    expect(updateEmployeeSchema.safeParse({ pan: 'ABCDE1234F' }).success).toBe(true);
    expect(updateEmployeeSchema.safeParse({ pan: 'abcde1234f' }).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({ uan: '12345' }).success).toBe(false);
  });

  it.each([
    ['bankAccount', '123456789012'],
    ['bankIfsc', 'HDFC0001234'],
    ['empCode', 'EMP-002'],
    ['status', 'ACTIVE'],
    ['pfStatus', 'MEMBER'],
    ['grossMonthlyRupees', 20_000],
    ['aadhaar', '123412341234'],
  ])('rejects %s rather than silently dropping it', (field, value) => {
    // A 200 that ignored the bank account the caller sent is worse than a 400:
    // the caller believes salary will now go to the new account.
    const result = updateEmployeeSchema.safeParse({ [field]: value });
    expect(result.success).toBe(false);
  });
});

describe('updateEmployeeBankSchema', () => {
  it('requires the account and the IFSC together', () => {
    expect(updateEmployeeBankSchema.safeParse({ bankAccount: '123456789012' }).success).toBe(false);
    expect(updateEmployeeBankSchema.safeParse({ bankIfsc: 'HDFC0001234' }).success).toBe(false);
    expect(updateEmployeeBankSchema.safeParse({
      bankAccount: '123456789012', bankIfsc: 'HDFC0001234',
    }).success).toBe(true);
  });

  it('accepts nothing but bank fields', () => {
    expect(updateEmployeeBankSchema.safeParse({
      bankAccount: '123456789012', bankIfsc: 'HDFC0001234', firstName: 'Mallory',
    }).success).toBe(false);
  });
});
