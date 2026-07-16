import { createContext, useContext, type ReactNode } from 'react';
import type { Permission } from '@peoplepulse/core';

/**
 * Front-end authorization.
 *
 * THE RULE, same as the server's: components check PERMISSIONS, never roles.
 *
 *   ✅ <Can I="payroll.run.finalize"><Button>Finalize</Button></Can>
 *   ❌ {user.role === 'HR_ADMIN' && <Button>Finalize</Button>}
 *
 * `Permission` is imported from @peoplepulse/core — the SAME registry the API
 * uses. A typo here is a compile error, not a button that silently never shows.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE YOU TRUST IT
 * ---------------------------------------------------------------------------
 * These checks are UX, NOT SECURITY.
 *
 * <Can> hides a button the user cannot use. It protects NOTHING. Anyone can
 * open devtools and call the endpoint directly. The API's PermissionGuard is
 * what actually stops them, and Postgres RLS backstops that.
 *
 * Never let a check in this file be the only thing between a user and an action.
 */

export interface Session {
  userId: string;
  tenantId: string;
  employeeId: string | null;
  mfaVerified: boolean;
  permissions: Permission[];
}

interface PermissionContextValue {
  session: Session | null;
  can: (permission: Permission) => boolean;
  canAny: (permissions: Permission[]) => boolean;
}

const PermissionContext = createContext<PermissionContextValue>({
  session: null,
  can: () => false,
  canAny: () => false,
});

export function PermissionProvider({
  session,
  children,
}: {
  session: Session | null;
  children: ReactNode;
}) {
  const granted = new Set(session?.permissions ?? []);

  const value: PermissionContextValue = {
    session,
    can: (permission) => granted.has(permission),
    canAny: (permissions) => permissions.some((p) => granted.has(p)),
  };

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions(): PermissionContextValue {
  return useContext(PermissionContext);
}

/**
 * Renders its children only if the user holds the permission.
 *
 * `fallback` is for the rare case where absence needs explaining — a salary
 * column showing "—" rather than vanishing, so the table does not reflow.
 * Usually you want nothing.
 */
export function Can({
  I,
  any,
  fallback = null,
  children,
}: {
  I?: Permission;
  any?: Permission[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { can, canAny } = usePermissions();

  const allowed = I ? can(I) : any ? canAny(any) : false;
  return <>{allowed ? children : fallback}</>;
}
