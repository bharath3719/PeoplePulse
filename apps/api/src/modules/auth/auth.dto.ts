import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /** Optional: which company to log in to. Only meaningful for multi-company users (D-16). */
  tenantId: z.string().uuid().optional(),
});

export const signupSchema = z.object({
  companyName: z.string().min(2).max(120),
  adminFirstName: z.string().min(1).max(80),
  adminEmail: z.string().email(),
  // NIST SP 800-63B: length beats composition rules. Long passphrases, no
  // "must contain a symbol" theatre that pushes people to Password1!.
  adminPassword: z.string().min(12, 'Use at least 12 characters'),
});

export const switchTenantSchema = z.object({ tenantId: z.string().uuid() });
export const mfaVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
