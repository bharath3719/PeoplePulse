import { Link } from 'react-router-dom';
import { CalendarPlus, Clock, LogIn, LogOut, Sun } from 'lucide-react';
import { toIstDate } from '@peoplepulse/core';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermissions } from '@/features/auth/permissions';
import { usePunch, usePunchStatus } from '@/features/attendance/api/attendance';
import { describeShift, punchTime } from '@/features/attendance/format';
import { useLeaveBalances } from '@/features/leave/api/leave';
import { figure, formatDate, problem, thisLeaveYear, unit } from '@/features/leave/format';
import { Widget } from './Widget';

/**
 * Your own day: punch in or out, and how much leave you have. Only for a login
 * linked to an employee record — an admin with none has no day to show.
 */
export function MyDay({ employeeId }: { employeeId: string }) {
  const { can } = usePermissions();
  return (
    <Widget title="Your day" icon={Sun}>
      <div className="grid gap-5 sm:grid-cols-2">
        {can('attendance.punch') && <PunchPanel />}
        {can('leave.apply') && <BalancePanel employeeId={employeeId} />}
      </div>
    </Widget>
  );
}

function PunchPanel() {
  const status = usePunchStatus();
  const punch = usePunch();

  if (status.isLoading) return <Skeleton className="h-28 rounded-lg" />;
  if (status.error || !status.data) {
    return <p className="text-sm text-destructive">{status.error ? problem(status.error) : 'Could not load'}</p>;
  }

  const { today, next } = status.data;
  const stillYesterday = today.date !== toIstDate(new Date());
  const last = today.punches[today.punches.length - 1];

  return (
    <div className="flex flex-col justify-between gap-3 rounded-lg border bg-muted/30 p-4">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {stillYesterday ? `Shift that began ${formatDate(today.date)}` : `Today, ${formatDate(today.date)}`}
        </p>
        <p className="mt-1 text-sm font-medium">
          {today.holiday ? `Holiday: ${today.holiday}` : today.weeklyOff ? 'Your weekly off' : today.shift ? describeShift(today.shift) : 'No shift set'}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {last
            ? `${today.punches.length} ${today.punches.length === 1 ? 'punch' : 'punches'} · last ${last.direction === 'OUT' ? 'out' : 'in'} at ${punchTime(last.at)}`
            : 'You haven’t punched in yet'}
        </p>
      </div>
      <div>
        <Button
          className="w-full"
          variant={next === 'IN' ? 'default' : 'outline'}
          disabled={punch.isPending}
          onClick={() => punch.mutate({ direction: next })}
        >
          {next === 'IN' ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
          {punch.isPending ? 'Punching…' : next === 'IN' ? 'Punch in' : 'Punch out'}
        </Button>
        {punch.isError && <p className="mt-1.5 text-xs text-destructive">{problem(punch.error)}</p>}
      </div>
    </div>
  );
}

/** Available days per type, as the server computed them. Nothing is added up here. */
function BalancePanel({ employeeId }: { employeeId: string }) {
  const year = thisLeaveYear();
  const balances = useLeaveBalances(employeeId, year);
  const shown = (balances.data ?? []).filter((b) => b.availableDays !== null).slice(0, 4);

  return (
    <div className="flex flex-col justify-between gap-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Leave you can take in {year}</p>
        {balances.isLoading ? (
          <div className="mt-2 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : shown.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No leave types with a balance yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {shown.map((b) => (
              <li key={b.leaveType.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate">{b.leaveType.name}</span>
                <span className="figures shrink-0 font-semibold">
                  {figure(b.availableDays!)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">{unit(b.availableDays!)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link to="/leave?apply=1" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
        <CalendarPlus className="h-4 w-4" /> Apply for leave
      </Link>
    </div>
  );
}
