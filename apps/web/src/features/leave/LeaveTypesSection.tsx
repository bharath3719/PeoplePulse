import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { z } from 'zod';
import {
  DEFAULT_LEAVE_TYPES, createLeaveTypeSchema, updateLeaveTypeSchema,
  type AccrualFrequency, type DayCountBasis,
} from '@peoplepulse/core';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useAddDefaultLeaveTypes, useCreateLeaveType, useLeaveTypes, useUpdateLeaveType, type LeaveType,
} from './api/leave';
import { describeYearEnd, showDays } from './format';

/** The leave types this company offers (LVE-01). */
export function LeaveTypesSection() {
  const types = useLeaveTypes();
  const addDefaults = useAddDefaultLeaveTypes();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const have = new Set(types.data?.map((t) => t.code));
  const missingDefaults = DEFAULT_LEAVE_TYPES.filter((t) => !have.has(t.code));
  const editing = types.data?.find((t) => t.id === editingId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          Leave types
          <span className="flex gap-2">
            {types.data && missingDefaults.length > 0 && (
              <Button size="sm" variant="outline" disabled={addDefaults.isPending} onClick={() => addDefaults.mutate()}>
                Add standard types ({missingDefaults.map((t) => t.code).join(', ')})
              </Button>
            )}
            {!adding && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> New type
              </Button>
            )}
          </span>
        </CardTitle>
        <CardDescription>
          A change applies from now on: credits already posted and leave already requested keep what they were.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {adding && <LeaveTypeForm onDone={() => setAdding(false)} />}
        {editing && <LeaveTypeForm key={editing.id} type={editing} onDone={() => setEditingId(null)} />}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                {['Type', 'Earned', 'Counts', 'At year end', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {types.data?.map((t) => (
                <tr key={t.id} className={t.isActive ? 'border-b last:border-0' : 'border-b text-muted-foreground last:border-0'}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{t.name}</span>{' '}
                    <span className="tabular text-xs text-muted-foreground">{t.code}</span>
                    {!t.isPaid && <span className="ml-2 text-xs">unpaid</span>}
                    {!t.isActive && <span className="ml-2 text-xs">retired</span>}
                  </td>
                  <td className="px-3 py-2">{describeAccrual(t)}</td>
                  <td className="px-3 py-2">
                    {t.dayCountBasis === 'CALENDAR_DAYS' ? 'calendar days' : 'working days'}
                    {t.allowsHalfDay ? ', half days' : ''}
                  </td>
                  <td className="px-3 py-2">{t.isPaid ? describeYearEnd(t) : '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(t.id)}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {addDefaults.isError && <p className="text-sm text-destructive">{addDefaults.error.message}</p>}
      </CardContent>
    </Card>
  );
}

function describeAccrual(t: LeaveType): string {
  if (t.accrualFrequency === 'NONE') return t.isPaid ? 'granted by HR' : '—';
  const per = t.accrualFrequency === 'MONTHLY' ? 'a year, monthly' : 'a year, up front';
  return `${showDays(t.annualEntitlementDays)} ${per}${t.proRataOnJoin ? ', pro-rata' : ''}`;
}

/** How much of a balance carries into the next year: nothing, up to a limit, or all of it. */
type CarryMode = 'NONE' | 'LIMIT' | 'ALL';

function carryModeOf(type: LeaveType | undefined): CarryMode {
  // A new type carries everything until HR says otherwise — the server's default too.
  if (!type || type.carryForwardMaxDays === null) return 'ALL';
  return type.carryForwardMaxDays === 0 ? 'NONE' : 'LIMIT';
}

/** Create a type, or — given one — edit it. Code and paid/unpaid are fixed once created. */
function LeaveTypeForm({ type, onDone }: { type?: LeaveType; onDone: () => void }) {
  const create = useCreateLeaveType();
  const update = useUpdateLeaveType(type?.id ?? '');
  const mutation = type ? update : create;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [carry, setCarry] = useState<CarryMode>(carryModeOf(type));
  // Unpaid leave has no balance, so nothing to carry or encash.
  const hasYearEnd = !type || type.isPaid;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const yearEnd = hasYearEnd
      ? {
        carryForwardMaxDays: carry === 'ALL' ? null : carry === 'NONE' ? 0 : Number(f.get('carryForwardMaxDays') || 0),
        // Carrying everything leaves nothing to encash.
        encashMaxDays: carry === 'ALL' ? 0 : Number(f.get('encashMaxDays') || 0),
      }
      : {};
    const common = {
      name: String(f.get('name') ?? ''),
      accrualFrequency: String(f.get('accrualFrequency')) as AccrualFrequency,
      annualEntitlementDays: Number(f.get('annualEntitlementDays') || 0),
      dayCountBasis: String(f.get('dayCountBasis')) as DayCountBasis,
      allowsHalfDay: f.get('allowsHalfDay') === 'on',
      proRataOnJoin: f.get('proRataOnJoin') === 'on',
      ...yearEnd,
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
    if (type) {
      const parsed = updateLeaveTypeSchema.safeParse({ ...common, isActive: f.get('isActive') === 'on' });
      if (parsed.success) update.mutate(parsed.data, options);
      else invalid(parsed.error);
    } else {
      const parsed = createLeaveTypeSchema.safeParse({
        ...common, code: String(f.get('code') ?? ''), isPaid: f.get('isPaid') === 'on',
      });
      if (parsed.success) create.mutate(parsed.data, options);
      else invalid(parsed.error);
    }
  }

  const unattributed = mutation.error instanceof ApiError && mutation.error.fieldErrors.length === 0
    ? mutation.error.message : null;

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border bg-muted/20 p-4" noValidate>
      <p className="text-sm font-medium">{type ? `Edit ${type.name}` : 'New leave type'}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {!type && (
          <Field label="Code" required error={errors['code']} hint="e.g. CL. Cannot be changed later.">
            <Input name="code" maxLength={10} />
          </Field>
        )}
        <Field label="Name" required error={errors['name']} className={type ? 'sm:col-span-3' : 'sm:col-span-2'}>
          <Input name="name" defaultValue={type?.name} maxLength={60} />
        </Field>
        <Field label="Earned" error={errors['accrualFrequency']}>
          <Select name="accrualFrequency" defaultValue={type?.accrualFrequency ?? 'NONE'}>
            <option value="NONE">Not earned — granted by HR</option>
            <option value="YEARLY">All at once, each year</option>
            <option value="MONTHLY">Monthly</option>
          </Select>
        </Field>
        <Field label="Days a year" error={errors['annualEntitlementDays']}>
          <Input name="annualEntitlementDays" type="number" step="0.01" min="0" defaultValue={type?.annualEntitlementDays ?? 0} />
        </Field>
        <Field label="Counts" error={errors['dayCountBasis']}>
          <Select name="dayCountBasis" defaultValue={type?.dayCountBasis ?? 'WORKING_DAYS'}>
            <option value="WORKING_DAYS">Working days</option>
            <option value="CALENDAR_DAYS">Calendar days (e.g. maternity)</option>
          </Select>
        </Field>
      </div>
      {hasYearEnd && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">At year end</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Carry into next year">
              <Select value={carry} onChange={(e) => setCarry(e.target.value as CarryMode)}>
                <option value="NONE">Nothing</option>
                <option value="LIMIT">Up to a limit</option>
                <option value="ALL">Everything</option>
              </Select>
            </Field>
            {carry === 'LIMIT' && (
              <Field label="Carry at most (days)" error={errors['carryForwardMaxDays']}>
                <Input
                  name="carryForwardMaxDays" type="number" step="0.01" min="0"
                  defaultValue={type?.carryForwardMaxDays ?? 0}
                />
              </Field>
            )}
            {carry !== 'ALL' && (
              <Field
                label="Encash at most (days)" error={errors['encashMaxDays']}
                hint="Of what does not carry. Anything left after that lapses."
              >
                <Input name="encashMaxDays" type="number" step="0.01" min="0" defaultValue={type?.encashMaxDays ?? 0} />
              </Field>
            )}
          </div>
        </fieldset>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {!type && <Check name="isPaid" label="Paid (has a balance)" defaultChecked />}
        <Check name="allowsHalfDay" label="Half days allowed" defaultChecked={type?.allowsHalfDay ?? true} />
        <Check name="proRataOnJoin" label="Pro-rata for joiners" defaultChecked={type?.proRataOnJoin ?? true} />
        {type && <Check name="isActive" label="Offered (untick to retire it)" defaultChecked={type.isActive} />}
      </div>
      {unattributed && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{unattributed}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={mutation.isPending}>{type ? 'Save' : 'Create'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4 rounded border-input" />
      {label}
    </label>
  );
}
