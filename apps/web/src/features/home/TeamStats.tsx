import { Link } from 'react-router-dom';
import { CalendarCheck, CalendarOff, PartyPopper, Users, type LucideIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermissions } from '@/features/auth/permissions';
import { useEmployees } from '@/features/employee/api/employees';
import { useHolidays, useLeaveRequests, usePendingDecisions } from '@/features/leave/api/leave';
import { formatDate, thisLeaveYear, today } from '@/features/leave/format';
import { daysFrom, relativeDays } from './dates';

/**
 * The row of numbers across the top of Home. Each is a count of rows the API
 * already returned and already scoped to this user — headcount is the people
 * they may see, "on leave" the requests they may see. Nothing is summed that a
 * ledger owns.
 */
export function TeamStats() {
  const { can } = usePermissions();
  const year = thisLeaveYear();
  const t = today();

  const seesTeamLeave = can('leave.view.all') || can('leave.view.team');
  const employees = useEmployees(undefined, can('employee.view.all'));
  const approved = useLeaveRequests({ status: 'APPROVED', year }, seesTeamLeave);
  const pending = usePendingDecisions(can('leave.approve'));
  const holidays = useHolidays(year);

  const active = (employees.data ?? []).filter((e) => e.status !== 'EXITED');
  const joined30 = active.filter((e) => e.joinDate <= t && daysFrom(e.joinDate, t) <= 30).length;
  const outToday = seesTeamLeave
    ? (approved.data ?? []).filter((r) => r.startDate <= t && r.endDate >= t)
    : [];
  const nextHoliday = (holidays.data ?? []).filter((h) => h.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {can('employee.view.all') && (
        <Stat
          to="/employees"
          icon={Users}
          label="People"
          loading={employees.isLoading}
          value={active.length}
          note={joined30 > 0 ? `${joined30} joined in the last 30 days` : 'No one new this month'}
        />
      )}
      {seesTeamLeave && (
        <Stat
          to="/leave/approvals"
          icon={CalendarOff}
          label="On leave today"
          loading={approved.isLoading}
          value={outToday.length}
          note={outToday.length === 0 ? 'Everyone is in' : outToday.slice(0, 2).map((r) => r.employee.name.split(' ')[0]).join(', ') + (outToday.length > 2 ? ` +${outToday.length - 2}` : '')}
        />
      )}
      {can('leave.approve') && (
        <Stat
          to="/leave/approvals"
          icon={CalendarCheck}
          label="Waiting on you"
          loading={pending.isLoading}
          value={pending.data?.length ?? 0}
          note={(pending.data?.length ?? 0) === 0 ? 'You are all caught up' : 'Leave requests to decide'}
          highlight={(pending.data?.length ?? 0) > 0}
        />
      )}
      <Stat
        to={can('leave.manage') ? '/leave/settings' : '/leave'}
        icon={PartyPopper}
        label="Next holiday"
        loading={holidays.isLoading}
        value={nextHoliday ? relativeDays(nextHoliday.date, t).replace(/^in /, '') : '—'}
        note={nextHoliday ? `${nextHoliday.name} · ${formatDate(nextHoliday.date)}` : `None left in ${year}`}
      />
    </div>
  );
}

function Stat({
  to, icon: Icon, label, value, note, loading, highlight,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  value: number | string;
  note: string;
  loading: boolean;
  highlight?: boolean;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border bg-card p-4 shadow-card transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className={highlight ? 'rounded-md bg-primary p-1.5 text-primary-foreground' : 'rounded-md bg-muted p-1.5 text-muted-foreground transition-colors group-hover:text-primary'}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-16" />
      ) : (
        <div className="figures mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      )}
      <p className="mt-1 truncate text-xs text-muted-foreground">{loading ? ' ' : note}</p>
    </Link>
  );
}
