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
  /**
   * The employee this login is for, when it is for one (D-26). Accepting links
   * the two, and the login's "own" leave and payslips are then that person's —
   * so naming one is bounded by `canLink`, as roles are by `canGrant`.
   */
  employeeId: z.string().uuid().optional(),
}).strict();

export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/**
 * Replace the roles a member holds in the active company.
 *
 * At least one. Access with no roles left is a removal, and removing someone is
 * its own action — it also ends their membership and the invitations they sent.
 */
export const updateMemberRolesSchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1, 'Pick at least one role — or remove them instead').max(20),
}).strict();

export type UpdateMemberRolesInput = z.infer<typeof updateMemberRolesSchema>;

/**
 * Which employee a member signs in as — or `null` for none (D-26). A login an
 * external accountant uses has none; an employee's own login has exactly one,
 * and no employee has two.
 */
export const linkEmployeeSchema = z.object({
  employeeId: z.string().uuid().nullable(),
}).strict();

export type LinkEmployeeInput = z.infer<typeof linkEmployeeSchema>;
