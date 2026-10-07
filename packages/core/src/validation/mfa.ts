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
