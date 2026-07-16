/**
 * The ONE place in the codebase where a user's permissions are compared to a
 * required permission.
 *
 * Everything else — the API's `@RequirePermission` guard, the serializer's
 * field redaction, the web app's `<Can>` component — routes through here.
 * If authorization is ever wrong, there is exactly one function to fix.
 */
import type { Permission } from './permissions';

/**
 * A resolved actor: who is making this request, in which company, holding what.
 *
 * `permissions` is the FLATTENED union of every role the user holds in the
 * ACTIVE tenant. The role names are deliberately absent from this type — if
 * they were here, someone would branch on them.
 */
export interface Actor {
  readonly userId: string;
  readonly tenantId: string;
  /** Null for external users (an accountant has no employee record). */
  readonly employeeId: string | null;
  readonly permissions: ReadonlySet<Permission>;
  readonly mfaVerified: boolean;
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

export function canAll(actor: Actor, permissions: readonly Permission[]): boolean {
  return permissions.every((p) => actor.permissions.has(p));
}

export function canAny(actor: Actor, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => actor.permissions.has(p));
}

export class ForbiddenError extends Error {
  constructor(readonly permission: Permission) {
    // Deliberately vague to the caller. A 403 that says WHICH permission is
    // missing tells an attacker the shape of the permission model.
    super('Forbidden');
    this.name = 'ForbiddenError';
  }
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new ForbiddenError(permission);
}

/**
 * Scope: "all employees" vs "my team" vs "just me".
 *
 * Three permissions express one idea, and this collapses them into a single
 * value the query layer can act on — so services never write:
 *
 *   if (can(a,'x.view.all')) {...} else if (can(a,'x.view.team')) {...} else {...}
 *
 * which is the `if`-sprawl we are avoiding. Services ask for the scope and
 * hand it to the repository, which turns it into a WHERE clause.
 */
export type Scope =
  | { kind: 'all' }
  | { kind: 'team'; managerEmployeeId: string }
  | { kind: 'own'; employeeId: string }
  | { kind: 'none' };

export function resolveScope(
  actor: Actor,
  perms: { all: Permission; team: Permission; own: Permission },
): Scope {
  if (can(actor, perms.all)) return { kind: 'all' };
  if (can(actor, perms.team) && actor.employeeId) {
    return { kind: 'team', managerEmployeeId: actor.employeeId };
  }
  if (can(actor, perms.own) && actor.employeeId) {
    return { kind: 'own', employeeId: actor.employeeId };
  }
  return { kind: 'none' };
}

/** The scope triples we actually use, named once so call sites cannot mistype. */
export const SCOPES = {
  employee: {
    all: 'employee.view.all',
    team: 'employee.view',
    own: 'employee.view',
  },
  attendance: {
    all: 'attendance.view.all',
    team: 'attendance.view.team',
    own: 'attendance.view.own',
  },
  leave: {
    all: 'leave.view.all',
    team: 'leave.view.team',
    own: 'leave.view.own',
  },
} as const satisfies Record<string, { all: Permission; team: Permission; own: Permission }>;
