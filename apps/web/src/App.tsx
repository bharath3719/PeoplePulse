import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Building2, LogOut, ShieldCheck, Upload, UserCog, Users } from 'lucide-react';
import { tokenStore } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth/api/auth';
import { Can, PermissionProvider, usePermissions } from '@/features/auth/permissions';
import { CompanySwitcher } from '@/features/auth/CompanySwitcher';
import { Login } from '@/features/auth/Login';
import { AcceptInvitation } from '@/features/auth/AcceptInvitation';
import { Security } from '@/features/auth/Security';
import { EmployeeList } from '@/features/employee/EmployeeList';
import { EmployeeDetail } from '@/features/employee/EmployeeDetail';
import { EmployeeNew } from '@/features/employee/EmployeeNew';
import { EmployeeEdit } from '@/features/employee/EmployeeEdit';
import { EmployeeBank } from '@/features/employee/EmployeeBank';
import { ImportEmployees } from '@/features/import/ImportEmployees';
import { CompanySettings } from '@/features/org/CompanySettings';
import { UserAccess } from '@/features/users/UserAccess';

/**
 * The app shell and the routing table.
 *
 * Everything below /login boots from ONE server call — GET /auth/me — because
 * the permissions the UI reflects have to be the permissions the API enforces.
 * Decoding them out of the JWT would be faster and would go stale the moment a
 * role changes; see the header comment in features/auth/permissions.tsx.
 */
export function App() {
  return (
    <Routes>
      {/* Outside the sign-in gate: whoever accepts may or may not be signed in
          already — the CA firm's accountant usually is, to another company. */}
      <Route path="/invite" element={<AcceptInvitation />} />
      <Route path="*" element={<Gate />} />
    </Routes>
  );
}

function Gate() {
  const location = useLocation();
  const hasToken = Boolean(tokenStore.get());
  const session = useSession();

  if (!hasToken) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location }} />} />
      </Routes>
    );
  }

  // A token in localStorage is a claim, not proof. Until /auth/me answers we do
  // not know who this is or what they may do, and rendering the shell early
  // would flash nav items the user may have no permission to see.
  if (session.isPending) return <Booting />;

  // The token is present but the server rejected it. api.ts already redirects on
  // a 401; landing here means something else went wrong (server down, network),
  // and sending the user to a login form they cannot use would be a lie.
  if (session.isError || !session.data) return <SessionFailed />;

  return (
    <PermissionProvider session={session.data}>
      <Shell>
        <Routes>
          <Route path="/employees" element={<EmployeeList />} />
          <Route path="/employees/new" element={<EmployeeNew />} />
          <Route path="/employees/:id" element={<EmployeeDetail />} />
          <Route path="/employees/:id/edit" element={<EmployeeEdit />} />
          <Route path="/employees/:id/bank" element={<EmployeeBank />} />
          <Route path="/import" element={<ImportEmployees />} />
          <Route path="/settings" element={<CompanySettings />} />
          <Route path="/users" element={<UserAccess />} />
          <Route path="/security" element={<Security />} />

          {/* Already signed in — the login form has nothing to offer. */}
          <Route path="/login" element={<Navigate to="/employees" replace />} />
          <Route path="/" element={<Navigate to="/employees" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Shell>
    </PermissionProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  function signOut() {
    tokenStore.clear();
    // A hard navigation, not a router push: it drops the TanStack Query cache,
    // which still holds this company's employee data.
    window.location.href = '/login';
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <span className="font-semibold tracking-tight">PeoplePulse</span>

          <nav className="flex items-center gap-1">
            <Can I="employee.view">
              <NavItem to="/employees" icon={Users}>People</NavItem>
            </Can>
            <Can I="employee.import">
              <NavItem to="/import" icon={Upload}>Import</NavItem>
            </Can>
            <Can I="tenant.settings">
              <NavItem to="/settings" icon={Building2}>Company</NavItem>
            </Can>
            <Can I="user.invite">
              <NavItem to="/users" icon={UserCog}>Users</NavItem>
            </Can>
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <CompanySwitcher />
            <NavLink
              to="/security"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ShieldCheck className="h-4 w-4" />
              Security
            </NavLink>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <MfaSetupNudge />

      <main className="mx-auto max-w-6xl p-4 py-8">{children}</main>
    </div>
  );
}

/**
 * For someone whose access needs a second factor and who has none yet. Not a
 * wall — the API refuses only the gated actions, and those offer setup in place
 * — but a reminder to do it now, at a desk, rather than mid-payroll.
 */
function MfaSetupNudge() {
  const { session } = usePermissions();
  const { pathname } = useLocation();
  if (!session?.mfaRequired || session.mfaEnrolled || pathname === '/security') return null;

  return (
    <div className="border-b bg-muted">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-sm">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <span>Some of what you can do here needs two-factor authentication.</span>
        <Link to="/security" className="font-medium text-primary hover:underline">Set it up</Link>
      </div>
    </div>
  );
}

function NavItem({
  to,
  icon: Icon,
  children,
}: {
  to: string;
  icon: typeof Users;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
          isActive
            ? 'bg-muted font-medium text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )
      }
    >
      <Icon className="h-4 w-4" />
      {children}
    </NavLink>
  );
}

function Booting() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

function SessionFailed() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="max-w-sm text-center">
        <p className="font-medium">We couldn&apos;t reach PeoplePulse.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your session is still valid. Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 text-sm text-primary hover:underline"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="font-medium">That page doesn&apos;t exist.</p>
      <NavLink to="/employees" className="mt-2 inline-block text-sm text-primary hover:underline">
        Back to People
      </NavLink>
    </div>
  );
}
