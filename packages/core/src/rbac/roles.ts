/**
 * Seeded roles (ADM-01).
 *
 * These are DEFAULTS, written into each tenant at provisioning (TR-02). They
 * are not hardcoded behaviour — a tenant may edit them or add custom roles,
 * because roles are data.
 *
 * Nothing in the codebase may branch on a role name. If you find yourself
 * wanting to, you want a permission instead. Add it to the registry.
 */
import { ALL_PERMISSIONS, type Permission } from './permissions';

export interface RoleDefinition {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly Permission[];
  /** System roles cannot be deleted, or a tenant could lock itself out. */
  readonly isSystem: boolean;
}

/** What every employee can do. Every other role is this plus more. */
const EMPLOYEE_PERMISSIONS: readonly Permission[] = [
  'attendance.punch',
  'attendance.view.own',
  'attendance.regularize',
  'leave.apply',
  'leave.view.own',
  'payslip.view.own',
  'employee.view', // their own profile; scope is enforced separately
];

const MANAGER_PERMISSIONS: readonly Permission[] = [
  ...EMPLOYEE_PERMISSIONS,
  'attendance.view.team',
  'attendance.approve',
  'leave.view.team',
  'leave.approve',
  'org.view',
];

const HR_ADMIN_PERMISSIONS: readonly Permission[] = [
  ...MANAGER_PERMISSIONS,
  'employee.view.all',
  'employee.create',
  'employee.edit',
  'employee.delete',
  'employee.import',
  'employee.export',
  'employee.identifiers.view',
  'org.manage',
  'attendance.view.all',
  'attendance.lock',
  'leave.view.all',
  'leave.manage',
  'user.invite',
  'user.manage',
  'role.view',
  'tenant.settings',
  'audit.view',
];

/**
 * Note what HR Admin does NOT get: salary visibility.
 *
 * That is deliberate and it is the single most-requested change we will get.
 * Many SMBs want an HR person who administers people without seeing pay. A
 * tenant that wants otherwise grants `employee.salary.view` to their HR role —
 * one click, no deploy. That is exactly why roles are data.
 */
const PAYROLL_ADMIN_PERMISSIONS: readonly Permission[] = [
  ...EMPLOYEE_PERMISSIONS,
  'employee.view.all',
  'employee.identifiers.view',
  'employee.salary.view',
  'employee.salary.edit',
  'employee.bank.edit',
  'org.view',
  'attendance.view.all',
  'attendance.lock',
  'attendance.unlock',
  'leave.view.all',
  'payroll.view',
  'payroll.run.create',
  'payroll.run.approve',
  'payroll.run.finalize',
  'payroll.structure.manage',
  'payroll.statutory.manage',
  'payroll.outputs.download',
  'payslip.view.all',
  'audit.view',
];

/**
 * The external accountant (BRD S5.2). A CA firm login with no employee record
 * behind it. Read-only: they pull registers and file returns, they do not run
 * payroll or touch employee data.
 *
 * A user may hold this role in SEVERAL tenants at once (D-16) — the CA firm
 * serves many of our customers. The company switcher resolves which one is
 * active; RLS still sees exactly one tenant per request.
 */
const ACCOUNTANT_PERMISSIONS: readonly Permission[] = [
  'employee.view.all',
  'employee.identifiers.view',
  'employee.salary.view',
  'org.view',
  'payroll.view',
  'payroll.outputs.download',
  'payslip.view.all',
];

export const SYSTEM_ROLES: readonly RoleDefinition[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Full access. Typically the founder or owner.',
    permissions: ALL_PERMISSIONS,
    isSystem: true,
  },
  {
    key: 'HR_ADMIN',
    name: 'HR Admin',
    description: 'Runs people operations. Cannot see salary unless granted.',
    permissions: HR_ADMIN_PERMISSIONS,
    isSystem: true,
  },
  {
    key: 'PAYROLL_ADMIN',
    name: 'Payroll Admin',
    description: 'Runs payroll and statutory filings. Sees salary and bank details.',
    permissions: PAYROLL_ADMIN_PERMISSIONS,
    isSystem: true,
  },
  {
    key: 'MANAGER',
    name: 'Manager',
    description: 'Approves leave and attendance for their team.',
    permissions: MANAGER_PERMISSIONS,
    isSystem: true,
  },
  {
    key: 'EMPLOYEE',
    name: 'Employee',
    description: 'Self-service only.',
    permissions: EMPLOYEE_PERMISSIONS,
    isSystem: true,
  },
  {
    key: 'ACCOUNTANT',
    name: 'Accountant (external)',
    description: 'Read-only access to payroll outputs for an external CA firm.',
    permissions: ACCOUNTANT_PERMISSIONS,
    isSystem: true,
  },
];

/**
 * The role granted to whoever signs the company up (TR-02).
 *
 * Named here, in the registry, rather than as a string literal in the signup
 * service — otherwise the role name leaks into application code, which is the
 * thing we are trying to prevent. Provisioning is the ONE legitimate reason to
 * refer to a role by name, and it refers to this constant.
 */
export const OWNER_ROLE_KEY = 'SUPER_ADMIN';

/**
 * Roles that must have MFA (NFR-04). Not because of their name — because of
 * what they can reach. Derived from the permissions, so a custom role that is
 * granted `payroll.run.finalize` automatically requires MFA too. Nobody has to
 * remember to add it.
 */
const MFA_REQUIRED_PERMISSIONS: readonly Permission[] = [
  'payroll.run.finalize',
  'payroll.run.approve',
  'employee.salary.edit',
  'employee.bank.edit',
  'role.manage',
  'user.manage',
];

export function requiresMfa(permissions: readonly Permission[]): boolean {
  return permissions.some((p) => MFA_REQUIRED_PERMISSIONS.includes(p));
}
