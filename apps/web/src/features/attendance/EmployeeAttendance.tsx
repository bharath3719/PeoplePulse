import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import type { z } from 'zod';
import { assignRosterSchema, toIstDate } from '@peoplepulse/core';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WEEKDAYS, formatDate, problem } from '@/features/leave/format';
import { AttendanceDays } from './AttendanceDays';
import { useAssignRoster, useRemoveRosterEntry, useRoster, useShifts, type Roster } from './api/attendance';
import { describeShift, describeWeeklyOffs, lastDays } from './format';

/**
 * An employee's attendance, on their profile: the roster they work to (ATT-04)
 * and their last week of punches. Changing the roster is offered only where the
 * server says it may be — never on your own profile, which the API refuses too.
 */
export function EmployeeAttendance({ employeeId }: { employeeId: string }) {
  const roster = useRoster(employeeId);
  const [assigning, setAssigning] = useState(false);
  const [from, to] = lastDays(7);

  if (roster.error) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Attendance</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {roster.error instanceof ApiError && roster.error.status === 404
            ? 'You can’t see this person’s attendance.'
            : roster.error.message}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          Attendance
          {roster.data?.canManage && !assigning && (
            <Button size="sm" variant="outline" onClick={() => setAssigning(true)}>
              <CalendarClock className="h-4 w-4" /> Change roster
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {roster.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {roster.data && (
          <>
            <Current roster={roster.data} />
            {assigning && <AssignRoster roster={roster.data} onDone={() => setAssigning(false)} />}
            {roster.data.entries.length > 0 && <RosterEntries roster={roster.data} />}
          </>
        )}
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Last seven days</h3>
          <AttendanceDays employeeId={employeeId} from={from} to={to} />
        </section>
      </CardContent>
    </Card>
  );
}

function Current({ roster }: { roster: Roster }) {
  const { shift, weeklyOffDays, from } = roster.current;
  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <p className="text-muted-foreground">Shift today</p>
        <p className="font-medium">{shift ? describeShift(shift) : 'None set'}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Weekly offs</p>
        <p className="font-medium">{describeWeeklyOffs(weeklyOffDays)}</p>
      </div>
      {from === 'COMPANY' && (
        <p className="col-span-2 text-xs text-muted-foreground">
          No roster covers today, so the company&apos;s default shift and weekly offs apply.
        </p>
      )}
    </div>
  );
}

function RosterEntries({ roster }: { roster: Roster }) {
  const remove = useRemoveRosterEntry();
  return (
    <div className="space-y-1">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              {['From', 'Shift', 'Weekly offs', ''].map((h, i) => (
                <th key={i} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roster.entries.map((entry) => (
              <tr key={entry.id} className="border-b last:border-0">
                <td className="whitespace-nowrap px-3 py-2">
                  {formatDate(entry.effectiveFrom)} {entry.effectiveFrom.slice(0, 4)}
                  {entry.effectiveFrom > roster.today && <span className="ml-2 text-xs text-muted-foreground">upcoming</span>}
                </td>
                <td className="px-3 py-2">{describeShift(entry.shift)}</td>
                <td className="px-3 py-2">{describeWeeklyOffs(entry.weeklyOffDays)}</td>
                <td className="px-3 py-2 text-right">
                  {roster.canManage && (
                    <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(entry.id)}>
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Each entry holds until the next one starts.</p>
      {remove.isError && <p className="text-sm text-destructive">{problem(remove.error)}</p>}
    </div>
  );
}

function AssignRoster({ roster, onDone }: { roster: Roster; onDone: () => void }) {
  const shifts = useShifts();
  const assign = useAssignRoster();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [offs, setOffs] = useState<Set<number>>(new Set(roster.current.weeklyOffDays));
  const active = shifts.data?.filter((s) => s.isActive) ?? [];

  function toggle(day: number) {
    const next = new Set(offs);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    setOffs(next);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    // The schema the API validates with, so the browser cannot accept what the server refuses.
    const parsed = assignRosterSchema.safeParse({
      employeeId: roster.employeeId,
      shiftId: String(f.get('shiftId') ?? ''),
      effectiveFrom: String(f.get('effectiveFrom') ?? ''),
      weeklyOffDays: [...offs],
    });
    setErrors({});
    if (!parsed.success) {
      setErrors(Object.fromEntries((parsed.error as z.ZodError).errors.map((err) => [err.path.join('.'), err.message])));
      return;
    }
    assign.mutate(parsed.data, {
      onSuccess: onDone,
      onError: (error) => {
        if (error instanceof ApiError) setErrors(Object.fromEntries(error.fieldErrors.map((x) => [x.field, x.message])));
      },
    });
  }

  const unattributed = assign.error instanceof ApiError && assign.error.fieldErrors.length === 0 ? assign.error.message : null;
  const currentShiftId = roster.current.shift && active.some((s) => s.id === roster.current.shift!.id) ? roster.current.shift.id : '';

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border bg-muted/20 p-4" noValidate>
      <div>
        <p className="text-sm font-medium">Change roster</p>
        <p className="text-xs text-muted-foreground">
          From the day you pick until their next roster entry. Leave already requested keeps the days it was counted with.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Shift" required error={errors['shiftId']}>
          <Select name="shiftId" defaultValue={currentShiftId}>
            <option value="" disabled>Pick a shift</option>
            {active.map((s) => <option key={s.id} value={s.id}>{describeShift(s)}</option>)}
          </Select>
        </Field>
        <Field label="From" required error={errors['effectiveFrom']}>
          <Input name="effectiveFrom" type="date" defaultValue={toIstDate(new Date())} />
        </Field>
      </div>
      <Field label="Weekly offs" error={errors['weeklyOffDays']}>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {WEEKDAYS.map((name, day) => (
            <label key={name} className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 rounded border-input" checked={offs.has(day)} onChange={() => toggle(day)} />
              {name}
            </label>
          ))}
        </div>
      </Field>
      {unattributed && <p className="text-sm text-destructive">{unattributed}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={assign.isPending}>{assign.isPending ? 'Saving…' : 'Save'}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
