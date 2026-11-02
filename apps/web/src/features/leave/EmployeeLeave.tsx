import { useState } from 'react';
import { History, SlidersHorizontal } from 'lucide-react';
import { LEAVE_ADJUSTMENT_KINDS, leaveAdjustmentSchema } from '@peoplepulse/core';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Can, usePermissions } from '@/features/auth/permissions';
import { BalanceCards } from './BalanceCards';
import { useAdjustLeave, useLeaveLedger, useLeaveTypes } from './api/leave';
import { ENTRY_KINDS, formatDate, showDays, thisLeaveYear } from './format';

/**
 * An employee's leave, on their profile: balances, the ledger behind them, and —
 * for `leave.manage` — a manual entry with its reason (LVE-08 opening balances,
 * corrections). The API decides whose leave is visible; this card shows its 404
 * as "can't see" rather than hiding, so a manager is not left wondering.
 */
export function EmployeeLeave({ employeeId }: { employeeId: string }) {
  const { session } = usePermissions();
  const year = thisLeaveYear();
  const [showing, setShowing] = useState<'history' | 'adjust' | null>(null);
  const own = session?.employeeId === employeeId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          Leave in {year}
          <span className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowing(showing === 'history' ? null : 'history')}>
              <History className="h-4 w-4" /> History
            </Button>
            {/* Nobody adjusts their own balance; the API refuses it too. */}
            {!own && (
              <Can I="leave.manage">
                <Button size="sm" variant="outline" onClick={() => setShowing(showing === 'adjust' ? null : 'adjust')}>
                  <SlidersHorizontal className="h-4 w-4" /> Adjust
                </Button>
              </Can>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <BalanceCards employeeId={employeeId} year={year} />
        {showing === 'adjust' && <AdjustBalance employeeId={employeeId} year={year} onDone={() => setShowing('history')} />}
        {showing === 'history' && <Ledger employeeId={employeeId} year={year} />}
      </CardContent>
    </Card>
  );
}

function Ledger({ employeeId, year }: { employeeId: string; year: number }) {
  const ledger = useLeaveLedger(employeeId, year, true);

  if (ledger.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!ledger.data?.length) return <p className="text-sm text-muted-foreground">Nothing on the ledger for {year}.</p>;

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            {['Type', 'Entry', 'Days', 'Why'].map((h) => (
              <th key={h} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ledger.data.map((e) => (
            <tr key={e.id} className="border-b last:border-0">
              <td className="tabular px-3 py-2">{e.leaveType.code}</td>
              <td className="px-3 py-2">{ENTRY_KINDS[e.kind] ?? e.kind}</td>
              <td className="px-3 py-2">{e.days > 0 ? '+' : ''}{showDays(e.days)}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {e.reason
                  ?? (e.request ? `${formatDate(e.request.startDate)} – ${formatDate(e.request.endDate)}` : e.accrualPeriod)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdjustBalance({ employeeId, year, onDone }: { employeeId: string; year: number; onDone: () => void }) {
  const types = useLeaveTypes();
  const adjust = useAdjustLeave();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = leaveAdjustmentSchema.safeParse({
      employeeId,
      calendarYear: year,
      leaveTypeId: String(f.get('leaveTypeId') ?? ''),
      kind: String(f.get('kind')),
      days: Number(f.get('days') || 0),
      reason: String(f.get('reason') ?? ''),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.errors.map((err) => [err.path.join('.'), err.message])));
      return;
    }
    setErrors({});
    adjust.mutate(parsed.data, {
      onSuccess: onDone,
      onError: (error) => {
        if (error instanceof ApiError) setErrors(Object.fromEntries(error.fieldErrors.map((x) => [x.field, x.message])));
      },
    });
  }

  const unattributed = adjust.error instanceof ApiError && adjust.error.fieldErrors.length === 0
    ? adjust.error.message : null;

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border bg-muted/20 p-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Type" required error={errors['leaveTypeId']}>
          <Select name="leaveTypeId" defaultValue="">
            <option value="">Choose…</option>
            {types.data?.filter((t) => t.isPaid).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Entry" error={errors['kind']}>
          <Select name="kind" defaultValue="ADJUSTMENT">
            {LEAVE_ADJUSTMENT_KINDS.map((k) => <option key={k} value={k}>{ENTRY_KINDS[k]}</option>)}
          </Select>
        </Field>
        <Field label="Days" required error={errors['days']} hint="Negative to take days away.">
          <Input name="days" type="number" step="0.01" />
        </Field>
      </div>
      <Field label="Reason" required error={errors['reason']} hint="Kept with the balance for good.">
        <Input name="reason" maxLength={300} placeholder="Balance carried over from the old spreadsheet" />
      </Field>
      {unattributed && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{unattributed}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={adjust.isPending}>Add to ledger</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
