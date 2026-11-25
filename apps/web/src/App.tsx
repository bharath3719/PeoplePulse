import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LogoMark } from '@/components/brand/logo';
import { buttonVariants } from '@/components/ui/button';
import { tokenStore } from '@/lib/api';
import { useSession } from '@/features/auth/api/auth';
import { PermissionProvider } from '@/features/auth/permissions';
import { AppShell } from '@/features/shell/AppShell';
import { Home } from '@/features/home/Home';
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
import { MyLeave } from '@/features/leave/MyLeave';
import { LeaveApprovals } from '@/features/leave/LeaveApprovals';
import { LeaveSettings } from '@/features/leave/LeaveSettings';
import { MyAttendance } from '@/features/attendance/MyAttendance';
import { ShiftSettings } from '@/features/attendance/ShiftSettings';

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
      <AppShell>
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/employees" element={<EmployeeList />} />
          <Route path="/employees/new" element={<EmployeeNew />} />
          <Route path="/employees/:id" element={<EmployeeDetail />} />
          <Route path="/employees/:id/edit" element={<EmployeeEdit />} />
          <Route path="/employees/:id/bank" element={<EmployeeBank />} />
          <Route path="/import" element={<ImportEmployees />} />
          <Route path="/settings" element={<CompanySettings />} />
          <Route path="/users" element={<UserAccess />} />
          <Route path="/leave" element={<MyLeave />} />
          <Route path="/leave/approvals" element={<LeaveApprovals />} />
          <Route path="/leave/settings" element={<LeaveSettings />} />
          <Route path="/attendance" element={<MyAttendance />} />
          <Route path="/attendance/shifts" element={<ShiftSettings />} />
          <Route path="/security" element={<Security />} />

          {/* Already signed in — the login form has nothing to offer. */}
          <Route path="/login" element={<Navigate to="/home" replace />} />
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppShell>
    </PermissionProvider>
  );
}

function Booting() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <LogoMark className="h-10 w-10 animate-shimmer" />
      <p className="sr-only">Loading…</p>
    </div>
  );
}

function SessionFailed() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="max-w-sm text-center">
        <LogoMark className="mx-auto mb-4 h-10 w-10" />
        <p className="font-medium">We couldn&apos;t reach PeoplePulse.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your session is still valid. Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={buttonVariants({ variant: 'outline', className: 'mt-4' })}
        >
          Retry
        </button>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-5xl font-semibold tracking-tight text-muted-foreground/40">404</p>
      <p className="mt-3 font-medium">That page doesn&apos;t exist.</p>
      <Link to="/home" className={buttonVariants({ variant: 'outline', className: 'mt-4' })}>
        Back to home
      </Link>
    </div>
  );
}
