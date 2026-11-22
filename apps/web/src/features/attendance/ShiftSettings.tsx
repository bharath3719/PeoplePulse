import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import type { z } from 'zod';
import { DEFAULT_SHIFT, createShiftSchema, formatClock, updateShiftSchema } from '@peoplepulse/core';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { problem } from '@/features/leave/format';
import { useCreateShift, useMakeDefaultShift, useShifts, useUpdateShift, type Shift } from './api/attendance';
import { hoursAndMinutes } from './format';

/**
 * Shifts (`attendance.manage`, ATT-04): the hours this company works. Who works
 * which is set on each person's profile, as their roster. The route is
 * reachable by anyone who types it; every change on it is refused by the API
 * without the permission.
 */
export function ShiftSettings() {
  const shifts = useShifts();
  const makeDefault = useMakeDefaultShift();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = shifts.data?.find((s) => s.id === editingId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/attendance" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Attendance
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shifts</h1>
        <p className="text-sm text-muted-foreground">
          The hours people work. The default applies to anyone whose profile has no roster.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            Shifts
            {!adding && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> New shift
              </Button>
            )}
          </CardTitle>
          <CardDescription>
            A shift that ends at or before it starts runs overnight, and its punches count on the day it began. New
            times apply to every day the shift is rostered on, until that month&apos;s attendance is locked.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {adding && <ShiftForm onDone={() => setAdding(false)} />}
          {editing && <ShiftForm key={editing.id} shift={editing} onDone={() => setEditingId(null)} />}

          {shifts.data?.length === 0 && (
            <p className="rounded-md border px-4 py-6 text-center text-sm text-muted-foreground">
              No shifts yet. Until there is one, punches count on the calendar day they happen.
            </p>
          )}
          {!!shifts.data?.length && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    {['Shift', 'Hours', 'Grace', ''].map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shifts.data.map((s) => (
                    <tr key={s.id} className={s.isActive ? 'border-b last:border-0' : 'border-b text-muted-foreground last:border-0'}>
                      <td className="px-3 py-2">
                        <span className="font-medium">{s.name}</span>{' '}
                        <span className="tabular text-xs text-muted-foreground">{s.code}</span>
                        {s.isDefault && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">Default</span>}
                        {!s.isActive && <span className="ml-2 text-xs">switched off</span>}
                      </td>
                      <td className="tabular px-3 py-2">
                        {s.startTime}–{s.endTime}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {hoursAndMinutes(s.lengthMinutes)}{s.crossesMidnight ? ', overnight' : ''}
                        </span>
                      </td>
                      <td className="tabular px-3 py-2">{s.graceMinutes} min</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {!s.isDefault && s.isActive && (
                          <Button size="sm" variant="ghost" disabled={makeDefault.isPending} onClick={() => makeDefault.mutate(s.id)}>
                            Make default
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(s.id)}>Edit</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {makeDefault.isError && <p className="text-sm text-destructive">{problem(makeDefault.error)}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

/** Create a shift, or — given one — edit it. The code is fixed once created. */
function ShiftForm({ shift, onDone }: { shift?: Shift; onDone: () => void }) {
  const create = useCreateShift();
  const update = useUpdateShift(shift?.id ?? '');
  const mutation = shift ? update : create;
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const common = {
      name: String(f.get('name') ?? ''),
      startTime: String(f.get('startTime') ?? ''),
      endTime: String(f.get('endTime') ?? ''),
      graceMinutes: Number(f.get('graceMinutes') || 0),
    };

    // The same schemas the API validates with, so the browser cannot accept
    // what the server will refuse.
    const invalid = (error: z.ZodError) =>
      setErrors(Object.fromEntries(error.errors.map((err) => [err.path.join('.'), err.message])));
    const options = {
      onSuccess: onDone,
      onError: (error: Error) => {
        if (error instanceof ApiError) setErrors(Object.fromEntries(error.fieldErrors.map((x) => [x.field, x.message])));
      },
    };

    setErrors({});
    if (shift) {
      const parsed = updateShiftSchema.safeParse({ ...common, isActive: f.get('isActive') === 'on' });
      if (parsed.success) update.mutate(parsed.data, options);
      else invalid(parsed.error);
    } else {
      const parsed = createShiftSchema.safeParse({ ...common, code: String(f.get('code') ?? '') });
      if (parsed.success) create.mutate(parsed.data, options);
      else invalid(parsed.error);
    }
  }

  const unattributed = mutation.error instanceof ApiError && mutation.error.fieldErrors.length === 0
    ? mutation.error.message : null;

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border bg-muted/20 p-4" noValidate>
      <p className="text-sm font-medium">{shift ? `Edit ${shift.name}` : 'New shift'}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {!shift && (
          <Field label="Code" required error={errors['code']} hint="e.g. NIGHT. Cannot be changed later.">
            <Input name="code" maxLength={10} />
          </Field>
        )}
        <Field label="Name" required error={errors['name']} className={shift ? 'sm:col-span-3' : 'sm:col-span-2'}>
          <Input name="name" defaultValue={shift?.name} maxLength={60} />
        </Field>
        <Field label="Starts" required error={errors['startTime']}>
          <Input name="startTime" type="time" defaultValue={shift?.startTime ?? formatClock(DEFAULT_SHIFT.startMinute)} />
        </Field>
        <Field label="Ends" required error={errors['endTime']} hint="At or before the start runs overnight">
          <Input name="endTime" type="time" defaultValue={shift?.endTime ?? formatClock(DEFAULT_SHIFT.endMinute)} />
        </Field>
        <Field label="Grace (minutes)" error={errors['graceMinutes']} hint="How late still counts as on time">
          <Input name="graceMinutes" type="number" min="0" max="120" defaultValue={shift?.graceMinutes ?? DEFAULT_SHIFT.graceMinutes} />
        </Field>
      </div>
      {shift && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" className="h-4 w-4 rounded border-input" defaultChecked={shift.isActive} />
          In use — a switched-off shift takes no new rosters; people already on it stay on it
        </label>
      )}
      {unattributed && <p className="text-sm text-destructive">{unattributed}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save'}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
