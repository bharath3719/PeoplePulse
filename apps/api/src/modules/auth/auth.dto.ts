import { z } from 'zod';
import { newPasswordSchema } from '@peoplepulse/core';

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
  adminPassword: newPasswordSchema,
});

export const switchTenantSchema = z.object({ tenantId: z.string().uuid() });
export const mfaVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) });

/** The secret from an invitation link: `<tenant id>.<secret>`, opaque to the client. */
export const invitationTokenSchema = z.object({ token: z.string().min(1).max(200) });

/**
 * `password` is the existing account's when the address already has one, else
 * the new account's. Which rule applies is the server's call, so the length rule
 * for a new password is enforced there rather than here.
 */
export const acceptInvitationSchema = invitationTokenSchema.extend({
  password: z.string().min(1).max(1024),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
