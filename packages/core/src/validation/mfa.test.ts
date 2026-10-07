import { describe, it, expect } from 'vitest';
import { mfaCodeSchema } from './mfa';

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
