import { useState } from 'react';
import { applyLeaveSchema, type PreviewLeaveInput, type Session } from '@peoplepulse/core';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApplyLeave, useLeavePreview, useLeaveTypes, type LeaveType } from './api/leave';
import { problem, showDays } from './format';

interface Draft {
  leaveTypeId: string;
  startDate: string;
  startSession: Session;
  endDate: string;
  endSession: Session;
  reason: string;
}

const EMPTY: Draft = {
  leaveTypeId: '', startDate: '', startSession: 'FIRST', endDate: '', endSession: 'SECOND', reason: '',
};

/**
 * Apply for leave (LVE-05). As the dates are filled in, the server says what it
 * will cost and what will be left — counted against this person's weekly offs
 * and their location's holidays, which the browser does not know — so nobody
 * finds out they are a day short after they have booked the train.
 */
export function ApplyLeave({ onDone }: { onDone: () => void }) {
  const types = useLeaveTypes();
  const apply = useApplyLeave();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const offered = types.data?.filter((t) => t.isActive) ?? [];
  const type = offered.find((t) => t.id === draft.leaveTypeId);
  const preview = useLeavePreview(previewInput(draft));

  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      // A one-day request is the common case: the end follows the start until
      // someone moves it.
      if (key === 'startDate' && (!current.endDate || current.endDate < String(value))) next.endDate = String(value);
      // A whole-days-only type cannot keep a half day picked under another type.
      if (key === 'leaveTypeId' && !offered.find((t) => t.id === value)?.allowsHalfDay) {
        next.startSession = 'FIRST';
        next.endSession = 'SECOND';
      }
      return next;
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = applyLeaveSchema.safeParse({ ...draft, reason: draft.reason || undefined });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.errors.map((err) => [err.path.join('.'), err.message])));
      return;
    }
    setErrors({});
    apply.mutate(parsed.data, {
      onSuccess: () => onDone(),
      onError: (error) => {
        if (error instanceof ApiError) {
          setErrors(Object.fromEntries(error.fieldErrors.map((err) => [err.field, err.message])));
        }
      },
    });
  }

  const unattributed = apply.error instanceof ApiError && apply.error.fieldErrors.length === 0
    ? apply.error.message
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Apply for leave</CardTitle>
        <CardDescription>
          Your manager is asked to approve it. Weekends and holidays inside the dates are not counted,
          except for leave that runs in calendar days.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Type" required error={errors['leaveTypeId']}>
            <Select
              value={draft.leaveTypeId}
              onChange={(e) => change('leaveTypeId', e.target.value)}
              aria-invalid={Boolean(errors['leaveTypeId'])}
            >
              <option value="">Choose…</option>
              {offered.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" required error={errors['startDate'] ?? errors['startSession']}>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={draft.startDate}
                  onChange={(e) => change('startDate', e.target.value)}
                  aria-invalid={Boolean(errors['startDate'])}
                />
                {type?.allowsHalfDay && (
                  <Select
                    aria-label="Starting"
                    className="w-40"
                    value={draft.startSession}
                    onChange={(e) => change('startSession', e.target.value as Session)}
                  >
                    <option value="FIRST">Full day</option>
                    <option value="SECOND">Second half</option>
                  </Select>
                )}
              </div>
            </Field>

            <Field label="To" required error={errors['endDate'] ?? errors['endSession']}>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={draft.endDate}
                  min={draft.startDate || undefined}
                  onChange={(e) => change('endDate', e.target.value)}
                  aria-invalid={Boolean(errors['endDate'])}
                />
                {type?.allowsHalfDay && (
                  <Select
                    aria-label="Ending"
                    className="w-40"
                    value={draft.endSession}
                    onChange={(e) => change('endSession', e.target.value as Session)}
                  >
                    <option value="SECOND">Full day</option>
                    <option value="FIRST">First half</option>
                  </Select>
                )}
              </div>
            </Field>
          </div>

          <Field label="Reason" hint="Optional. Your manager sees it." error={errors['reason']}>
            <Input value={draft.reason} maxLength={500} onChange={(e) => change('reason', e.target.value)} />
          </Field>

          <Cost type={type} preview={preview} />

          {unattributed && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{unattributed}</p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={apply.isPending || preview.isError}>
              {apply.isPending ? 'Sending…' : 'Apply'}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** The preview line: what this costs, or the server's reason it cannot be taken. */
function Cost({ type, preview }: { type: LeaveType | undefined; preview: ReturnType<typeof useLeavePreview> }) {
  if (preview.isError) {
    return <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{problem(preview.error)}</p>;
  }
  if (!preview.data || !type) return null;

  const { days, isPaid, availableAfterDays } = preview.data;
  return (
    <p className="rounded-md bg-muted px-3 py-2 text-sm">
      <span className="font-medium">{showDays(days)}</span> of {type.name}.{' '}
      {isPaid
        ? <>You will have {showDays(availableAfterDays ?? 0)} left.</>
        : 'Unpaid — deducted from pay as loss of pay.'}
    </p>
  );
}

function previewInput(draft: Draft): PreviewLeaveInput | null {
  if (!draft.leaveTypeId || !draft.startDate || !draft.endDate) return null;
  const { reason: _reason, ...span } = draft;
  return span;
}
