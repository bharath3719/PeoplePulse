import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Actor, Permission } from '@peoplepulse/core';
import { PermissionGuard, actorOrThrow } from './permission.guard';
import { PERMISSION_KEY, PUBLIC_KEY, SKIP_MFA_KEY } from './require-permission.decorator';
import type { AuthedRequest } from '../auth/authed-request';

/**
 * The single authorization check in the API.
 *
 * Every test here tries to get through the guard WITHOUT the right to. The one
 * failure mode that matters is the guard letting someone past, so a suite that
 * only asserts "the admin gets in" would be worthless.
 */

interface RouteMetadata {
  [PERMISSION_KEY]?: Permission;
  [PUBLIC_KEY]?: boolean;
  [SKIP_MFA_KEY]?: boolean;
}

/**
 * A guard needs a Reflector and an ExecutionContext, and building real ones
 * means booting Nest. Instead we hand it a Reflector whose metadata lookup is
 * backed by a plain object — the guard cannot tell the difference, because all
 * it ever does is ask "what does this route declare?".
 */
function contextFor(metadata: RouteMetadata, actor: Actor | undefined) {
  const reflector = {
    getAllAndOverride: (key: string) => metadata[key as keyof RouteMetadata],
  } as unknown as Reflector;

  const request = { actor } as AuthedRequest;

  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { guard: new PermissionGuard(reflector), context };
}

function actor(permissions: Permission[], mfaVerified = false): Actor {
  return {
    userId: 'u1',
    tenantId: 't1',
    employeeId: 'e1',
    permissions: new Set(permissions),
    mfaVerified,
  };
}

describe('PermissionGuard', () => {
  it('lets a public route through with no actor at all', () => {
    const { guard, context } = contextFor({ [PUBLIC_KEY]: true }, undefined);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects an unauthenticated caller with 401, not 403', () => {
    // "Who are you" precedes "may you". A 403 here would tell an anonymous
    // caller that the route exists and that they merely lack a permission.
    const { guard, context } = contextFor({ [PERMISSION_KEY]: 'employee.view' }, undefined);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects an authenticated caller who lacks the permission', () => {
    const { guard, context } = contextFor(
      { [PERMISSION_KEY]: 'employee.salary.view' },
      actor(['employee.view']),
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('does not name the missing permission in the rejection', () => {
    // A 403 that says WHICH permission is missing hands an attacker the shape of
    // the permission model, one probe at a time.
    const { guard, context } = contextFor(
      { [PERMISSION_KEY]: 'payroll.run.approve' },
      actor(['employee.view'], true),
    );

    try {
      guard.canActivate(context);
      expect.unreachable('the guard should have thrown');
    } catch (error) {
      expect(JSON.stringify((error as ForbiddenException).getResponse())).not.toContain('payroll');
    }
  });

  it('admits a caller holding exactly the required permission', () => {
    const { guard, context } = contextFor(
      { [PERMISSION_KEY]: 'employee.view' },
      actor(['employee.view']),
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows an authenticated route that requires no specific permission', () => {
    // e.g. "list my own payslips" — scoped in the service, not by the guard.
    const { guard, context } = contextFor({}, actor([]));

    expect(guard.canActivate(context)).toBe(true);
  });

  describe('MFA (NFR-04)', () => {
    it('blocks an MFA-gated permission when the second factor is outstanding', () => {
      const { guard, context } = contextFor(
        { [PERMISSION_KEY]: 'payroll.run.finalize' },
        actor(['payroll.run.finalize'], false),
      );

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('says MFA_REQUIRED, so the client can prompt rather than despair', () => {
      const { guard, context } = contextFor(
        { [PERMISSION_KEY]: 'payroll.run.finalize' },
        actor(['payroll.run.finalize'], false),
      );

      try {
        guard.canActivate(context);
        expect.unreachable('the guard should have thrown');
      } catch (error) {
        const body = (error as ForbiddenException).getResponse() as { code?: string };
        expect(body.code).toBe('MFA_REQUIRED');
      }
    });

    it('admits the same caller once MFA is verified', () => {
      const { guard, context } = contextFor(
        { [PERMISSION_KEY]: 'payroll.run.finalize' },
        actor(['payroll.run.finalize'], true),
      );

      expect(guard.canActivate(context)).toBe(true);
    });

    it('derives the MFA requirement from the PERMISSION, not from a role name', () => {
      // The whole point: a tenant that invents a custom role and grants it
      // payroll.run.finalize inherits the MFA gate with no code change. There is
      // no role in this test at all — there is nowhere to put one.
      const { guard, context } = contextFor(
        { [PERMISSION_KEY]: 'employee.view' },
        actor(['employee.view'], false),
      );

      expect(guard.canActivate(context)).toBe(true); // not MFA-gated, so no prompt
    });

    it('lets the MFA endpoints themselves through on a half-authenticated token', () => {
      const { guard, context } = contextFor(
        { [SKIP_MFA_KEY]: true, [PERMISSION_KEY]: 'payroll.run.finalize' },
        actor(['payroll.run.finalize'], false),
      );

      expect(guard.canActivate(context)).toBe(true);
    });
  });
});

describe('actorOrThrow', () => {
  it('returns the actor when the request is authenticated', () => {
    const a = actor(['employee.view']);

    expect(actorOrThrow({ actor: a } as AuthedRequest)).toBe(a);
  });

  it('throws rather than returning undefined for a service to dereference', () => {
    expect(() => actorOrThrow({} as AuthedRequest)).toThrow(UnauthorizedException);
  });
});
