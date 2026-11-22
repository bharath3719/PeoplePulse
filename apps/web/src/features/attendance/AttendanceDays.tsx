import { ApiError } from '@/lib/api';
import { formatDate } from '@/features/leave/format';
import { useAttendanceDays, type AttendanceDay } from './api/attendance';
import { describeShift, punchTime } from './format';

/**
 * Attendance days, newest first, each with its shift and the punches the server
 * filed under it. Raw punches only: whether a day is present, late or half is
 * day derivation's to say (TR-11), and the page does not guess ahead of it.
 */
export function AttendanceDays({ employeeId, from, to }: { employeeId: string; from: string; to: string }) {
  const days = useAttendanceDays(employeeId, from, to);

  if (days.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (days.error) {
    return (
      <p className="text-sm text-muted-foreground">
        {days.error instanceof ApiError && days.error.status === 404
          ? 'You can’t see this person’s attendance.'
          : days.error.message}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border bg-background">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            {['Day', 'Shift', 'Punches'].map((h) => (
              <th key={h} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.data?.map((day) => (
            <tr key={day.date} className="border-b align-top last:border-0">
              <td className="whitespace-nowrap px-3 py-2 font-medium">{formatDate(day.date)}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {day.shift ? describeShift(day.shift) : 'No shift'}
                <DayNote day={day} />
              </td>
              <td className="px-3 py-2">
                {day.punches.length === 0
                  ? <span className="text-muted-foreground">—</span>
                  : <Punches punches={day.punches} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayNote({ day }: { day: AttendanceDay }) {
  if (day.holiday) return <span className="block text-xs">Holiday: {day.holiday}</span>;
  if (day.weeklyOff) return <span className="block text-xs">Weekly off</span>;
  return null;
}

export function Punches({ punches }: { punches: AttendanceDay['punches'] }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {punches.map((p) => (
        <span key={p.id} className="tabular whitespace-nowrap">
          <span className="text-xs text-muted-foreground">{p.direction === 'IN' ? 'In' : p.direction === 'OUT' ? 'Out' : 'Punch'}</span>{' '}
          {punchTime(p.at)}
        </span>
      ))}
    </span>
  );
}
