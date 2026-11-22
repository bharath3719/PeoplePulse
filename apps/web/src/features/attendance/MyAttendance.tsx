import { useNavigate } from 'react-router-dom';
import { Clock, LogIn, LogOut, Settings2 } from 'lucide-react';
import { toIstDate } from '@peoplepulse/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Can, usePermissions } from '@/features/auth/permissions';
import { formatDate, problem } from '@/features/leave/format';
import { AttendanceDays, Punches } from './AttendanceDays';
import { usePunch, usePunchStatus } from './api/attendance';
import { describeShift, lastDays } from './format';

/**
 * Your attendance (ATT-02): punch in and out, and the last week's punches.
 *
 * The time of a punch is the server's — the page sends only which button was
 * pressed — and so is which day it belongs to, which for a night shift is not
 * the date on the calendar.
 */
export function MyAttendance() {
  const { session } = usePermissions();
  const navigate = useNavigate();
  const employeeId = session?.employeeId ?? null;
  const [from, to] = lastDays(7);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
          <p className="text-sm text-muted-foreground">Punch in and out, and see your last seven days.</p>
        </div>
        <Can I="attendance.manage">
          <Button variant="outline" onClick={() => navigate('/attendance/shifts')}>
            <Settings2 className="h-4 w-4" /> Shifts
          </Button>
        </Can>
      </div>

      {!employeeId ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Your login isn&apos;t linked to an employee record, so there is no attendance to show or punch.
          </CardContent>
        </Card>
      ) : (
        <>
          <PunchCard />
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">Last seven days</h2>
            <AttendanceDays employeeId={employeeId} from={from} to={to} />
          </section>
        </>
      )}
    </div>
  );
}

function PunchCard() {
  const status = usePunchStatus();
  const punch = usePunch();

  if (status.isLoading) return <Card><CardContent className="py-8 text-sm text-muted-foreground">Loading…</CardContent></Card>;
  if (status.error || !status.data) {
    return <Card><CardContent className="py-8 text-sm text-destructive">{status.error ? problem(status.error) : 'Could not load'}</CardContent></Card>;
  }

  const { today, next } = status.data;
  // Past midnight on a night shift, "today" is still the day the shift began.
  const stillYesterday = today.date !== toIstDate(new Date());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" />
          {stillYesterday ? `Still on the shift that began ${formatDate(today.date)}` : `Today, ${formatDate(today.date)}`}
        </CardTitle>
        <CardDescription>
          {today.shift ? describeShift(today.shift) : 'No shift set'}
          {today.holiday && <> · Holiday: {today.holiday}</>}
          {!today.holiday && today.weeklyOff && <> · Your weekly off</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm">
          {today.punches.length === 0
            ? <span className="text-muted-foreground">No punches yet.</span>
            : <Punches punches={today.punches} />}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            size="lg"
            variant={next === 'IN' ? 'default' : 'outline'}
            disabled={punch.isPending}
            onClick={() => punch.mutate({ direction: next })}
          >
            {next === 'IN' ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
            {punch.isPending ? 'Punching…' : next === 'IN' ? 'Punch in' : 'Punch out'}
          </Button>
          {punch.isError && <p className="text-sm text-destructive">{problem(punch.error)}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
