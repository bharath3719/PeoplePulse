import {
  Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, requiresMfa, type Actor, type Permission } from '@peoplepulse/core';
import { PERMISSION_KEY, PUBLIC_KEY, SKIP_MFA_KEY } from './require-permission.decorator';
import type { AuthedRequest } from '../auth/authed-request';

/**
 * THE authorization check. The only one.
 *
 * Every protected route in the API passes through here, and nowhere else in the
 * codebase compares a user's permissions against a required permission. If
 * authorization is ever wrong, there is one function to fix.
 *
 * Note what is NOT here: any mention of a role. Roles are data — bags of
 * permissions that each tenant can edit without a deploy (ADM-01). Code checks
 * capabilities, never identities. See ENGINEERING-STANDARDS.md §1.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const actor = request.actor;

    // Not authenticated at all. 401, not 403 — "who are you" precedes "may you".
    if (!actor) throw new UnauthorizedException();

    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY, targets,
    );

    // An authenticated route with no @RequirePermission is a route any logged-in
    // user of the tenant may call (e.g. "list my own payslips", scoped in the
    // service). That is legitimate, but it must be a DECISION — so we still
    // require the route to be non-public, which forces the author to think.
    if (!required) return true;

    // --- MFA (NFR-04) -----------------------------------------------------
    //
    // Derived from the PERMISSION, not from a role name. A tenant that invents
    // a custom role and grants it `payroll.run.finalize` gets the MFA
    // requirement automatically. Nobody has to remember to add it.
    const skipMfa = this.reflector.getAllAndOverride<boolean>(SKIP_MFA_KEY, targets);
    if (!skipMfa && requiresMfa([required]) && !actor.mfaVerified) {
      throw new ForbiddenException({
        code: 'MFA_REQUIRED',
        detail: 'This action requires multi-factor authentication.',
      });
    }

    if (!can(actor, required)) {
      // Deliberately vague. A 403 naming the missing permission hands an
      // attacker the shape of the permission model, one probe at a time.
      throw new ForbiddenException();
    }

    return true;
  }
}

/** Narrow helper for services that need the actor. */
export function actorOrThrow(request: AuthedRequest): Actor {
  if (!request.actor) throw new UnauthorizedException();
  return request.actor;
}
