import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@peoplepulse/core';

export const PERMISSION_KEY = 'required_permission';

/**
 * Declares what a handler needs. The check itself lives in PermissionGuard —
 * there is exactly ONE place in this codebase that compares a user's
 * permissions to a required one.
 *
 *   @Post('runs/:id/finalize')
 *   @RequirePermission('payroll.run.finalize')
 *   finalize(@Param('id') id: string) {
 *     return this.payroll.finalize(id);   // <- business logic only
 *   }
 *
 * The handler contains no authorization branch. It cannot forget to check,
 * because it was never asked to.
 *
 * `Permission` is a union of the registry keys, so a typo here is a COMPILE
 * ERROR rather than an endpoint that silently authorizes everybody.
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

export const PUBLIC_KEY = 'is_public';

/**
 * Opts an endpoint out of auth entirely — login, signup, health, the careers
 * page. Deliberately explicit: everything is protected unless it says otherwise,
 * so forgetting to annotate a route fails CLOSED (401), not open.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const SKIP_MFA_KEY = 'skip_mfa';

/** For the MFA endpoints themselves, which run on a half-authenticated token. */
export const SkipMfa = () => SetMetadata(SKIP_MFA_KEY, true);
