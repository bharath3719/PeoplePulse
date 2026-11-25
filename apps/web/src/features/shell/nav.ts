import {
  Building2, CalendarCheck, CalendarDays, CalendarRange, Clock, Home, KeyRound, Timer, Upload, UserCog, Users,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@peoplepulse/core';

/**
 * Every place in the app, once. The sidebar, the command menu and the top bar's
 * breadcrumb all read this, so a page cannot be in one and missing from another.
 *
 * Each item names the permission that shows it — a permission, never a role
 * (ENGINEERING-STANDARDS.md). Hiding is UX; the API is what refuses.
 */
export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown only to someone holding it. Absent: everyone signed in. */
  permission?: Permission;
  /** Lit only on this exact path, so Leave is not lit while you are on Approvals. */
  end?: boolean;
  /** Extra words the command menu matches on. */
  keywords?: string[];
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { to: '/home', label: 'Home', icon: Home, keywords: ['dashboard', 'today'] },
      { to: '/leave/approvals', label: 'Approvals', icon: CalendarCheck, permission: 'leave.approve', keywords: ['inbox', 'requests', 'approve'] },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/employees', label: 'Employees', icon: Users, permission: 'employee.view', keywords: ['people', 'staff', 'directory'] },
      { to: '/import', label: 'Import', icon: Upload, permission: 'employee.import', keywords: ['excel', 'upload', 'bulk'] },
    ],
  },
  {
    label: 'Time',
    items: [
      { to: '/attendance', label: 'Attendance', icon: Clock, permission: 'attendance.punch', end: true, keywords: ['punch', 'clock in', 'clock out'] },
      { to: '/leave', label: 'Leave', icon: CalendarDays, permission: 'leave.apply', end: true, keywords: ['time off', 'holiday', 'balance'] },
      { to: '/attendance/shifts', label: 'Shifts and rosters', icon: Timer, permission: 'attendance.manage', keywords: ['roster', 'schedule'] },
      { to: '/leave/settings', label: 'Leave policy', icon: CalendarRange, permission: 'leave.manage', keywords: ['leave types', 'holidays', 'year end', 'accrual'] },
    ],
  },
  {
    label: 'Company',
    items: [
      { to: '/settings', label: 'Company settings', icon: Building2, permission: 'tenant.settings', keywords: ['org', 'departments', 'locations', 'pf', 'esi'] },
      { to: '/users', label: 'Users and access', icon: UserCog, permission: 'user.invite', keywords: ['invite', 'roles', 'permissions'] },
    ],
  },
];

/** Not in the sidebar (it lives in the user menu), but a place the command menu and breadcrumb know. */
export const SECURITY: NavItem = { to: '/security', label: 'Security', icon: KeyRound, keywords: ['two-factor', '2fa', 'mfa', 'recovery'] };

/** The nav item a path belongs to: the longest `to` that prefixes it. */
export function matchNav(pathname: string): { group: NavGroup | null; item: NavItem } | null {
  let best: { group: NavGroup | null; item: NavItem } | null = null;
  const candidates: { group: NavGroup | null; item: NavItem }[] = [
    ...NAV.flatMap((group) => group.items.map((item) => ({ group, item }))),
    { group: null, item: SECURITY },
  ];
  for (const c of candidates) {
    const hit = pathname === c.item.to || pathname.startsWith(`${c.item.to}/`);
    if (hit && (!best || c.item.to.length > best.item.to.length)) best = c;
  }
  return best;
}
