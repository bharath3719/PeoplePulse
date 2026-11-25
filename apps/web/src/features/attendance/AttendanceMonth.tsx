import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  WEEK_MONDAY_FIRST, datesBetween, datesIn, dayOfMonth, leadingBlanks, monthLabel, monthOf, shiftMonth, type Month,
} from '@/lib/calendar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermissions } from '@/features/auth/permissions';
import { useLeaveLedger } from '@/features/leave/api/leave';
import { today } from '@/features/leave/format';
import { useAttendanceDays, type AttendanceDay } from './api/attendance';
import { punchTime } from './format';

/**
 * A month of someone's attendance as a calendar: each day's first punch in and
 * last punch out, their weekly offs and holidays, and approved leave.
 *
 * It labels, it does not judge. Whether a day is present, late, half or absent
 * is day derivation's to decide (TR-11, still to come in Slice 3), so a working
 * day without punches reads "No punches", never "Absent".
 */
export function AttendanceMonth({ employeeId }: { employeeId: string }) {
  const { canAny } = usePermissions();
  const t = today();
  const [month, setMonth] = useState<Month>(monthOf(t));
  const dates = datesIn(month);
  const days = useAttendanceDays(employeeId, dates[0]!, dates[dates.length - 1]!);
  const leaveOn = useLeaveDays(employeeId, Number(month.slice(0, 4)), canAny(['leave.view.own', 'leave.view.team', 'leave.view.all']));

  if (days.error) {
    return (
      <p className="text-sm text-muted-foreground">
        {days.error instanceof ApiError && days.error.status === 404 ? 'You can’t see this person’s attendance.' : days.error.message}
      </p>
    );
  }

  const byDate = new Map((days.data ?? []).map((d) => [d.date, d]));
  const counts = { punched: 0, leave: 0, off: 0 };
  for (const date of dates) {
    const d = byDate.get(date);
    if (!d || date > t) continue;
    if (d.punches.length > 0) counts.punched++;
    else if (leaveOn.has(date) && !d.weeklyOff && !d.holiday) counts.leave++;
    else if (d.weeklyOff || d.holiday) counts.off++;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= monthOf(t)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h3 className="ml-2 text-sm font-semibold">{monthLabel(month)}</h3>
          {month !== monthOf(t) && (
            <Button variant="link" size="sm" onClick={() => setMonth(monthOf(t))}>This month</Button>
          )}
        </div>
        <p className="figures text-xs text-muted-foreground">
          {counts.punched} days with punches · {counts.leave} on leave · {counts.off} off
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-7 border-b bg-muted/40">
          {WEEK_MONDAY_FIRST.map((d) => (
            <div key={d} className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: leadingBlanks(month) }, (_, i) => (
            <div key={`b${i}`} className="min-h-[76px] border-b border-r bg-muted/20 last:border-r-0" />
          ))}
          {dates.map((date) => (
            <DayCell key={date} date={date} day={byDate.get(date)} leave={leaveOn.get(date)} isToday={date === t} future={date > t} loading={days.isLoading} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Legend className="bg-success/15 ring-success/30">Punched</Legend>
        <Legend className="bg-primary/15 ring-primary/30">On leave</Legend>
        <Legend className="bg-info/15 ring-info/30">Holiday</Legend>
        <Legend className="bg-muted ring-border">Weekly off</Legend>
      </div>
    </div>
  );
}

function DayCell({
  date, day, leave, isToday, future, loading,
}: {
  date: string;
  day: AttendanceDay | undefined;
  leave: string | undefined;
  isToday: boolean;
  future: boolean;
  loading: boolean;
}) {
  const first = day?.punches.find((p) => p.direction !== 'OUT') ?? day?.punches[0];
  const last = [...(day?.punches ?? [])].reverse().find((p) => p.direction === 'OUT');
  const off = day?.weeklyOff && !day.holiday;
  const onLeave = leave && !day?.weeklyOff && !day?.holiday;

  return (
    <div
      className={cn(
        'min-h-[76px] border-b border-r p-1.5 text-xs [&:nth-child(7n)]:border-r-0',
        off && 'bg-muted/50',
        day?.holiday && 'bg-info/5',
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'figures inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-medium',
            isToday ? 'bg-primary text-primary-foreground' : future ? 'text-muted-foreground/60' : 'text-muted-foreground',
          )}
        >
          {dayOfMonth(date)}
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-1.5 h-4 w-full" />
      ) : (
        <div className="mt-1 space-y-0.5">
          {day?.holiday && <Chip className="bg-info/15 text-info">{day.holiday}</Chip>}
          {off && <span className="block text-muted-foreground">Off</span>}
          {onLeave && <Chip className="bg-primary/15 text-brand-soft-foreground">Leave · {leave}</Chip>}
          {first && (
            <Chip className="figures bg-success/15 text-success">
              {punchTime(first.at)}
              {last && last !== first ? ` – ${punchTime(last.at)}` : ''}
            </Chip>
          )}
          {!first && !future && !off && !day?.holiday && !onLeave && day && (
            <span className="block text-muted-foreground/70">No punches</span>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={cn('block truncate rounded px-1 py-0.5 font-medium', className)}>{children}</span>;
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-2.5 w-2.5 rounded-sm ring-1', className)} />
      {children}
    </span>
  );
}

/**
 * Approved leave by date, from the person's own ledger: every DEBIT names the
 * request it took days for, and a REVERSAL gives them back. The ledger is per
 * person, so it is complete where a company-wide request list would be capped.
 */
function useLeaveDays(employeeId: string, year: number, enabled: boolean): Map<string, string> {
  const ledger = useLeaveLedger(employeeId, year, enabled);
  const out = new Map<string, string>();
  const entries = ledger.data ?? [];
  const reversed = new Set(entries.filter((e) => e.kind === 'REVERSAL' && e.request).map((e) => e.request!.id));
  for (const e of entries) {
    if (e.kind !== 'DEBIT' || !e.request || reversed.has(e.request.id)) continue;
    for (const d of datesBetween(e.request.startDate, e.request.endDate)) out.set(d, e.leaveType.code);
  }
  return out;
}
