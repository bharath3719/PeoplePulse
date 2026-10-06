import { describe, it, expect } from 'vitest';
import { inviteUserSchema, newPasswordSchema } from './invitation';

const ROLE = '7d1f4c1e-3b7a-4f7e-9a51-2a1c0f8e6b11';

describe('inviting a user', () => {
  it('normalises the email, since it is matched against a lower-cased unique column', () => {
    const parsed = inviteUserSchema.parse({ email: '  Ravi@CA-Firm.in ', roleIds: [ROLE] });
    expect(parsed.email).toBe('ravi@ca-firm.in');
  });

  it('refuses an invitation that grants nothing', () => {
    expect(inviteUserSchema.safeParse({ email: 'ravi@ca-firm.in', roleIds: [] }).success).toBe(false);
  });

  it('refuses fields it does not know, rather than ignoring them', () => {
    // An `employeeId` or `tenantId` smuggled in must fail loudly, not be dropped
    // while the caller believes it took effect.
    const result = inviteUserSchema.safeParse({
      email: 'ravi@ca-firm.in', roleIds: [ROLE], tenantId: ROLE,
    });
    expect(result.success).toBe(false);
  });
});

describe('a new password', () => {
  it('wants length, not symbols', () => {
    expect(newPasswordSchema.safeParse('short').success).toBe(false);
    expect(newPasswordSchema.safeParse('correct horse battery').success).toBe(true);
  });
});
