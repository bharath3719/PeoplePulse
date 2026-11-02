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

/**
 * May this actor hand out a role carrying these permissions? Only if they hold
 * every one of them already.
 *
 * Without this bound, `user.invite` is a quiet route to everything: an HR Admin
 * who cannot see salaries invites a second address of their own as Payroll
 * Admin, accepts, and now can. Granting is bounded by holding.
 */
export function canGrant(actor: Actor, permissions: readonly Permission[]): boolean {
  return canAll(actor, permissions);
}

/**
 * May this actor tie a login holding `permissions` to an employee record?
 *
 * A link is not a permission, but it is access: the login's `own` scopes — and
 * through `team`, the employee's reports — now mean THAT employee. Their leave
 * today; their payslips in Phase 2. So, like granting, linking is bounded by
 * what the linker can already see: the company-wide permission of every family
 * the login holds a narrower one in.
 *
 * Without it, an HR Admin who cannot see pay invites a second address of their
 * own, linked to the founder's employee record, and reads the founder's
 * payslip as "my own". `canGrant` stops them handing themselves a role; this
 * stops them handing themselves a person.
 */
export function canLink(actor: Pick<Actor, 'permissions'>, permissions: readonly Permission[]): boolean {
  return LINKED_SCOPES.every(({ all, narrower }) =>
    actor.permissions.has(all) || !narrower.some((p) => permissions.includes(p)));
}

/**
 * Every family of "whose X may you see", with the permissions that make a
 * login's employee link matter. rbac.test.ts fails if a `.own` permission is
 * added to the registry and not listed here.
 */
export const LINKED_SCOPES: readonly { all: Permission; narrower: readonly Permission[] }[] = [
  { all: 'employee.view.all', narrower: ['employee.view'] },
  { all: 'attendance.view.all', narrower: ['attendance.view.team', 'attendance.view.own'] },
  { all: 'leave.view.all', narrower: ['leave.view.team', 'leave.view.own'] },
  { all: 'payslip.view.all', narrower: ['payslip.view.own'] },
];

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
