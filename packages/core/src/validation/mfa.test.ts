import { describe, it, expect } from 'vitest';
import { mfaCodeSchema, mfaRecoveryCodeSchema } from './mfa';

describe('mfaCodeSchema', () => {
  it('takes the code as the app displays it', () => {
    expect(mfaCodeSchema.parse({ code: '123 456' })).toEqual({ code: '123456' });
    expect(mfaCodeSchema.parse({ code: ' 012345 ' })).toEqual({ code: '012345' });
  });

  it('refuses anything that is not six digits', () => {
    for (const code of ['12345', '1234567', '12345a', '', '１２３４５６']) {
      expect(mfaCodeSchema.safeParse({ code }).success).toBe(false);
    }
  });

  it('refuses fields it does not know', () => {
    expect(mfaCodeSchema.safeParse({ code: '123456', secret: 'x' }).success).toBe(false);
  });
});

describe('mfaRecoveryCodeSchema', () => {
  it('takes the code however it was retyped', () => {
    for (const typed of ['abcd-efgh-ijkm-nop2', 'ABCD EFGH IJKM NOP2', 'abcdefghijkmnop2', ' Abcd-Efgh-Ijkm-Nop2 ']) {
      expect(mfaRecoveryCodeSchema.parse({ recoveryCode: typed })).toEqual({ recoveryCode: 'abcdefghijkmnop2' });
    }
  });

  it('refuses what cannot have been issued', () => {
    // Too short, too long, and 0/1/8/9 — outside the base32 alphabet.
    for (const recoveryCode of ['abcd-efgh-ijkm', 'abcd-efgh-ijkm-nop2-q', 'abcd-efgh-ijkm-nop0', '123456']) {
      expect(mfaRecoveryCodeSchema.safeParse({ recoveryCode }).success).toBe(false);
    }
  });
});
