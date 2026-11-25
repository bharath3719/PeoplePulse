import { CalendarOff, Coffee } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { useLeaveRequests } from '@/features/leave/api/leave';
import { formatDate, thisLeaveYear, today } from '@/features/leave/format';
import { RowsSkeleton, Widget } from './Widget';

/**
 * Who is away today, from approved leave this user may see — their team, or
 * everyone for HR. Attendance's "who is in" waits on day derivation (Slice 3);
 * this is the half that can be answered now.
 */
export function OutToday() {
  const t = today();
  const approved = useLeaveRequests({ status: 'APPROVED', year: thisLeaveYear() });
  const out = (approved.data ?? [])
    .filter((r) => r.startDate <= t && r.endDate >= t)
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name));

  return (
    <Widget title="Out today" icon={CalendarOff} link={out.length > 0 ? { to: '/leave/approvals', label: 'Leave' } : undefined}>
      {approved.isLoading ? (
        <RowsSkeleton rows={2} />
      ) : out.length === 0 ? (
        <EmptyState compact icon={Coffee} title="Everyone’s in" description="No approved leave for today." />
      ) : (
        <ul className="space-y-3">
          {out.slice(0, 6).map((r) => {
            const half =
              r.startDate === t && r.startSession === 'SECOND' ? 'Afternoon only'
              : r.endDate === t && r.endSession === 'FIRST' ? 'Morning only'
              : null;
            return (
              <li key={r.id} className="flex items-center gap-3">
                <Avatar name={r.employee.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.employee.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {/* "Until", never "back on": the day after may be their weekly off, which this list does not know. */}
                    {r.leaveType.name} · {half ?? (r.endDate === t ? 'today only' : `until ${formatDate(r.endDate)}`)}
                  </p>
                </div>
              </li>
            );
          })}
          {out.length > 6 && <li className="text-xs text-muted-foreground">and {out.length - 6} more</li>}
        </ul>
      )}
    </Widget>
  );
}
