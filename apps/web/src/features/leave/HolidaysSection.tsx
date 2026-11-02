import { useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { createHolidaySchema } from '@peoplepulse/core';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrg } from '@/features/org/api/org';
import { useCreateHoliday, useDeleteHoliday, useHolidays } from './api/leave';
import { formatDate, thisLeaveYear } from './format';

/** Holidays, per location or for all of them (LVE-04). */
export function HolidaysSection() {
  const [year, setYear] = useState(thisLeaveYear());
  const holidays = useHolidays(year);
  const remove = useDeleteHoliday();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          Holidays
          <span className="flex items-center gap-1">
            <Button size="icon" variant="ghost" aria-label="Previous year" onClick={() => setYear(year - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="tabular w-12 text-center text-sm">{year}</span>
            <Button size="icon" variant="ghost" aria-label="Next year" onClick={() => setYear(year + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </span>
        </CardTitle>
        <CardDescription>
          Days off for everyone they apply to: working-day leave over them costs nothing. Adding or
          removing one does not re-count leave that has already been requested.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <AddHoliday year={year} />

        {holidays.data?.length === 0 && <p className="text-sm text-muted-foreground">No holidays for {year} yet.</p>}
        {holidays.data && holidays.data.length > 0 && (
          <ul className="divide-y rounded-md border">
            {holidays.data.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                <span className="tabular w-28 shrink-0">{formatDate(h.date)}</span>
                <span className="flex-1 font-medium">{h.name}</span>
                <span className="text-muted-foreground">{h.locationName ?? 'All locations'}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${h.name}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(h.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {remove.isError && <p className="text-sm text-destructive">{remove.error.message}</p>}
      </CardContent>
    </Card>
  );
}

function AddHoliday({ year }: { year: number }) {
  const org = useOrg();
  const create = useCreateHoliday();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const parsed = createHolidaySchema.safeParse({
      date: String(f.get('date') ?? ''),
      name: String(f.get('name') ?? ''),
      locationId: String(f.get('locationId') ?? '') || null,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.errors.map((err) => [err.path.join('.'), err.message])));
      return;
    }
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: () => form.reset(),
      onError: (error) => {
        if (error instanceof ApiError) setErrors(Object.fromEntries(error.fieldErrors.map((x) => [x.field, x.message])));
      },
    });
  }

  const unattributed = create.error instanceof ApiError && create.error.fieldErrors.length === 0
    ? create.error.message : null;

  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr_12rem_auto] sm:items-end">
        <Field label="Date" error={errors['date']}>
          <Input name="date" type="date" min={`${year}-01-01`} max={`${year}-12-31`} />
        </Field>
        <Field label="Name" error={errors['name']}>
          <Input name="name" placeholder="Kannada Rajyotsava" maxLength={80} />
        </Field>
        <Field label="Where" error={errors['locationId']}>
          <Select name="locationId" defaultValue="">
            <option value="">All locations</option>
            {org.data?.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Button type="submit" disabled={create.isPending}>Add</Button>
      </div>
      {unattributed && <p className="text-sm text-destructive">{unattributed}</p>}
    </form>
  );
}
