import { z } from 'zod';

/**
 * A password for a login being created — at signup, or on accepting an
 * invitation without an existing account.
 *
 * NIST SP 800-63B: length beats composition rules. Long passphrases, no "must
 * contain a symbol" theatre that pushes people to Password1!.
 */
export const newPasswordSchema = z.string().min(12, 'Use at least 12 characters');

/**
 * Invite someone to the active company (D-16).
 *
 * The email is normalised here, once, because it is matched against `user.email`
 * — which is unique platform-wide and stored lower-cased — to decide whether
 * accepting creates a login or attaches an existing one.
 */
export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  roleIds: z.array(z.string().uuid()).min(1, 'Pick at least one role').max(20),
}).strict();

export type InviteUserInput = z.infer<typeof inviteUserSchema>;
