import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  PERMISSIONS, ALL_PERMISSIONS, isSensitive, isPermission, type Permission,
} from './permissions';
import { SYSTEM_ROLES, requiresMfa } from './roles';
import {
  can, canAll, canAny, canGrant, requirePermission, resolveScope, SCOPES,
  ForbiddenError, type Actor,
} from './authorize';

function actorWith(...permissions: Permission[]): Actor {
  return {
    userId: 'u1',
    tenantId: 't1',
    employeeId: 'e1',
    permissions: new Set(permissions),
    mfaVerified: true,
  };
}

describe('the permission registry', () => {
  it('is the single source of truth', () => {
    expect(ALL_PERMISSIONS.length).toBe(Object.keys(PERMISSIONS).length);
    expect(isPermission('payroll.run.finalize')).toBe(true);
    expect(isPermission('payroll.run.yolo')).toBe(false);
  });

  it('marks the permissions that expose PII and pay', () => {
    // BRD risk R4 is a PII breach. These are the fields that would be it.
    expect(isSensitive('employee.salary.view')).toBe(true);
    expect(isSensitive('employee.identifiers.view')).toBe(true);
    expect(isSensitive('leave.apply')).toBe(false);
  });
});

describe('seeded roles', () => {
  it('grants every role only permissions that exist', () => {
    for (const role of SYSTEM_ROLES) {
      for (const p of role.permissions) {
        expect(isPermission(p), `${role.key} grants unknown permission "${p}"`).toBe(true);
      }
    }
  });

  it('gives Super Admin everything', () => {
    const superAdmin = SYSTEM_ROLES.find((r) => r.key === 'SUPER_ADMIN')!;
    expect(superAdmin.permissions).toHaveLength(ALL_PERMISSIONS.length);
  });

  it('does NOT give HR Admin salary visibility by default', () => {
    // Deliberate. Many SMBs want HR to administer people without seeing pay.
    // A tenant that disagrees grants the permission — no deploy.
    const hr = SYSTEM_ROLES.find((r) => r.key === 'HR_ADMIN')!;
    expect(hr.permissions).not.toContain('employee.salary.view');
    expect(hr.permissions).toContain('employee.edit');
  });

  it('gives Payroll Admin salary and the finalize button', () => {
    const payroll = SYSTEM_ROLES.find((r) => r.key === 'PAYROLL_ADMIN')!;
    expect(payroll.permissions).toContain('employee.salary.view');
    expect(payroll.permissions).toContain('payroll.run.finalize');
  });

  it('keeps the external accountant read-only', () => {
    const ca = SYSTEM_ROLES.find((r) => r.key === 'ACCOUNTANT')!;
    expect(ca.permissions).toContain('payroll.outputs.download');
    expect(ca.permissions).not.toContain('payroll.run.finalize');
    expect(ca.permissions).not.toContain('employee.edit');
  });

  it('derives the MFA requirement from permissions, not from the role name', () => {
    // So a CUSTOM role granted `payroll.run.finalize` requires MFA automatically.
    // Nobody has to remember to add it. NFR-04.
    const payroll = SYSTEM_ROLES.find((r) => r.key === 'PAYROLL_ADMIN')!;
    const employee = SYSTEM_ROLES.find((r) => r.key === 'EMPLOYEE')!;

    expect(requiresMfa(payroll.permissions)).toBe(true);
    expect(requiresMfa(employee.permissions)).toBe(false);
    expect(requiresMfa(['payroll.run.finalize'])).toBe(true); // a custom role
  });
});

describe('authorization', () => {
  it('allows and denies on permissions', () => {
    const actor = actorWith('leave.apply', 'leave.view.own');
    expect(can(actor, 'leave.apply')).toBe(true);
    expect(can(actor, 'payroll.run.finalize')).toBe(false);
    expect(canAll(actor, ['leave.apply', 'leave.view.own'])).toBe(true);
    expect(canAll(actor, ['leave.apply', 'payroll.view'])).toBe(false);
    expect(canAny(actor, ['payroll.view', 'leave.apply'])).toBe(true);
  });

  it('never widens a scope a role cannot enter', () => {
    // `employee.view.all` widens `employee.view`, which gates the endpoints.
    // The Accountant role shipped holding the first without the second, and
    // landed on a 403 that the People page rendered as "No employees yet".
    for (const role of SYSTEM_ROLES) {
      if (role.permissions.includes(SCOPES.employee.all)) {
        expect(role.permissions, role.key).toContain(SCOPES.employee.own);
      }
    }
  });

  it('lets an actor grant only what they already hold', () => {
    // An HR Admin who cannot see pay must not be able to invite a second login
    // of their own as Payroll Admin, and see it that way.
    const hr = SYSTEM_ROLES.find((r) => r.key === 'HR_ADMIN')!;
    const payroll = SYSTEM_ROLES.find((r) => r.key === 'PAYROLL_ADMIN')!;
    const manager = SYSTEM_ROLES.find((r) => r.key === 'MANAGER')!;
    const actor = actorWith(...hr.permissions);

    expect(canGrant(actor, manager.permissions)).toBe(true);
    expect(canGrant(actor, hr.permissions)).toBe(true);
    expect(canGrant(actor, payroll.permissions)).toBe(false);
    expect(canGrant(actor, [...manager.permissions, 'employee.salary.view'])).toBe(false);
  });

  it('throws Forbidden without naming the missing permission', () => {
    // A 403 that says WHICH permission is missing hands an attacker the shape
    // of the permission model.
    const actor = actorWith('leave.apply');
    expect(() => requirePermission(actor, 'payroll.run.finalize')).toThrow(ForbiddenError);
    try {
      requirePermission(actor, 'payroll.run.finalize');
    } catch (e) {
      expect((e as Error).message).toBe('Forbidden');
      expect((e as Error).message).not.toContain('payroll');
    }
  });
});

describe('scope — collapses three permissions into one value', () => {
  it('resolves all / team / own / none', () => {
    expect(resolveScope(actorWith('attendance.view.all'), SCOPES.attendance))
      .toEqual({ kind: 'all' });

    expect(resolveScope(actorWith('attendance.view.team'), SCOPES.attendance))
      .toEqual({ kind: 'team', managerEmployeeId: 'e1' });

    expect(resolveScope(actorWith('attendance.view.own'), SCOPES.attendance))
      .toEqual({ kind: 'own', employeeId: 'e1' });

    expect(resolveScope(actorWith(), SCOPES.attendance))
      .toEqual({ kind: 'none' });
  });

  it('prefers the widest scope the actor holds', () => {
    const actor = actorWith('attendance.view.all', 'attendance.view.team', 'attendance.view.own');
    expect(resolveScope(actor, SCOPES.attendance)).toEqual({ kind: 'all' });
  });

  it('denies team scope to an actor with no employee record', () => {
    // An external accountant has no employee row, so "my team" is meaningless.
    const ca: Actor = {
      userId: 'u2', tenantId: 't1', employeeId: null,
      permissions: new Set<Permission>(['attendance.view.team']),
      mfaVerified: true,
    };
    expect(resolveScope(ca, SCOPES.attendance)).toEqual({ kind: 'none' });
  });
});

/**
 * The rule the Product Lead actually asked for: no role checks scattered
 * through the code. This test enforces it mechanically, so it cannot rot.
 */
describe('no role-name branching anywhere in the codebase', () => {
  const ROOT = join(import.meta.dirname, '../../../..');
  const ROLE_KEYS = SYSTEM_ROLES.map((r) => r.key);

  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) sourceFiles(path, acc);
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(path);
    }
    return acc;
  }

  /**
   * Strip comments before scanning. Documentation is allowed to SHOW the
   * anti-pattern — that is how anyone learns not to write it. Only real code
   * is an offence.
   */
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  }

  it('never compares against a role name outside roles.ts', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(join(ROOT, 'packages')).concat(
      // apps/ may not exist yet; guard so this test works from day one.
      readdirSync(ROOT).includes('apps') ? sourceFiles(join(ROOT, 'apps')) : [],
    )) {
      if (file.endsWith('roles.ts')) continue; // where the names are DEFINED

      const source = stripComments(readFileSync(file, 'utf8'));
      for (const key of ROLE_KEYS) {
        // e.g.  role === 'HR_ADMIN'   |   role == "PAYROLL_ADMIN"
        const branching = new RegExp(`[=!]==?\\s*['"\`]${key}['"\`]`);
        if (branching.test(source)) {
          offenders.push(`${file}: branches on role "${key}" — use a permission instead`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
