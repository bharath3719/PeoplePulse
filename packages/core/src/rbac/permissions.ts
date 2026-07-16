/**
 * The permission registry. One source of truth, imported by BOTH the API and
 * the web app, so a typo is a compile error rather than a silent security hole.
 *
 * THE RULE: code checks PERMISSIONS. Code never checks ROLES.
 *
 * A role is a bag of permissions. It is data — it lives in the database, it
 * differs per tenant (ADM-01 requires custom roles), and it changes without a
 * deploy. The moment you write `if (user.role === 'HR_ADMIN')` you have
 * hardcoded a business rule into a branch, and you will write it 400 more
 * times. See ENGINEERING-STANDARDS.md S1.
 */

export const PERMISSIONS = {
  // --- Employees (Core HR) ---
  'employee.view':            'View employee profiles',
  'employee.view.all':        'View ALL employees, not just own team',
  'employee.create':          'Add employees',
  'employee.edit':            'Edit employee details',
  'employee.delete':          'Delete employees',
  'employee.import':          'Bulk-import employees from Excel',
  'employee.export':          'Export employee data',

  // --- Sensitive fields (ADM-01: field-level sensitivity) ---
  // These gate FIELDS, not endpoints. Redaction happens in the serializer.
  'employee.salary.view':     'View salary and CTC — SENSITIVE',
  'employee.salary.edit':     'Change salary structures — SENSITIVE',
  'employee.identifiers.view': 'View PAN, UAN, ESIC, bank details — SENSITIVE',
  'employee.bank.edit':       'Change bank account details — SENSITIVE',

  // --- Org structure ---
  'org.view':                 'View org structure',
  'org.manage':               'Manage locations, departments, designations, grades',

  // --- Attendance ---
  'attendance.punch':         'Punch in and out',
  'attendance.view.own':      'View own attendance',
  'attendance.view.team':     'View team attendance',
  'attendance.view.all':      'View all attendance',
  'attendance.regularize':    'Request attendance regularization',
  'attendance.approve':       'Approve regularization requests',
  'attendance.lock':          'Lock a month — feeds payroll, IRREVERSIBLE without unlock',
  'attendance.unlock':        'Unlock a locked month — voids draft payroll runs',

  // --- Leave ---
  'leave.apply':              'Apply for leave',
  'leave.view.own':           'View own leave balance and history',
  'leave.view.team':          'View team leave',
  'leave.view.all':           'View all leave',
  'leave.approve':            'Approve leave requests',
  'leave.manage':             'Configure leave types, holidays, and balances',

  // --- Payroll ---
  'payroll.view':             'View payroll runs',
  'payroll.run.create':       'Create and preview a payroll run',
  'payroll.run.approve':      'Approve a payroll run',
  'payroll.run.finalize':     'Finalize payroll — IRREVERSIBLE',
  'payroll.structure.manage': 'Manage salary structures and components',
  'payroll.statutory.manage': 'Manage PF/ESI/PT/TDS configuration',
  'payroll.outputs.download': 'Download ECR, bank files, and statutory registers',
  'payslip.view.own':         'View own payslips',
  'payslip.view.all':         'View anyone\'s payslips — SENSITIVE',

  // --- Platform administration ---
  'role.view':                'View roles and permissions',
  'role.manage':              'Create and edit roles — grants the ability to grant',
  'user.invite':              'Invite users',
  'user.manage':              'Manage user accounts and access',
  'audit.view':               'View the audit log',
  'tenant.settings':          'Manage company settings and statutory registration',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/**
 * Permissions that expose salary, statutory identifiers, or bank details.
 *
 * Held separately because they need extra handling: granting one is audited,
 * and reading a field behind one is audited (TR-52). BRD risk R4 is a PII
 * breach, and these are the fields that would constitute it.
 */
export const SENSITIVE_PERMISSIONS: readonly Permission[] = [
  'employee.salary.view',
  'employee.salary.edit',
  'employee.identifiers.view',
  'employee.bank.edit',
  'payslip.view.all',
] as const;

export function isSensitive(permission: Permission): boolean {
  return SENSITIVE_PERMISSIONS.includes(permission);
}

/**
 * Actions that cannot be undone, and must therefore be confirmed in the UI
 * and audited without exception.
 */
export const IRREVERSIBLE_PERMISSIONS: readonly Permission[] = [
  'payroll.run.finalize',
  'employee.delete',
] as const;

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}
