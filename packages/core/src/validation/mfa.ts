import { z } from 'zod';

/**
 * A code from an authenticator app (TOTP, RFC 6238): six digits.
 *
 * Spaces are dropped first — apps display "123 456", and people type what they
 * see. Whether the code is RIGHT is the server's question; this only says
 * whether it is worth asking.
 */
export const mfaCodeSchema = z.object({
  code: z.string().transform((s) => s.replace(/\s+/g, '')).pipe(
    z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
  ),
}).strict();

export type MfaCodeInput = z.infer<typeof mfaCodeSchema>;

/**
 * Strip a recovery code down to what was issued: lower case, no separators.
 * Codes are shown as `abcd-efgh-ijkm-nopq`; people retype them with spaces,
 * capitals, or no dashes at all, and every one of those is the same code.
 */
export function normaliseRecoveryCode(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A recovery code, used in place of a code from the authenticator when the
 * phone is gone: 16 characters from the RFC 4648 base32 alphabet, 80 random bits.
 */
export const mfaRecoveryCodeSchema = z.object({
  recoveryCode: z.string().transform(normaliseRecoveryCode).pipe(
    z.string().regex(/^[a-z2-7]{16}$/, 'Enter one of your recovery codes — 16 letters and digits'),
  ),
}).strict();

export type MfaRecoveryCodeInput = z.infer<typeof mfaRecoveryCodeSchema>;
