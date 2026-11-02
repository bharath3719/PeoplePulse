import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { toIstDate } from '@peoplepulse/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePermissions } from '@/features/auth/permissions';
import { LeaveStatusBadge } from './LeaveStatusBadge';
import { useDecideLeave, useLeaveRequests, type LeaveRequest } from './api/leave';
import { describeSpan, formatDate, showDays, thisLeaveYear } from './format';

/**
 * Leave waiting on you (LVE-03, ESS-02). What is offered here is what the server
 * said you may decide; it checks again — scope, balance, and that nobody beat
 * you to it — when you click.
 */
export function LeaveApprovals() {
  const { session } = usePermissions();
  const pending = useLeaveRequests({ status: 'PENDING' });
  const year = thisLeaveYear();
  const recent = useLeaveRequests({ year });

  const waiting = pending.data?.filter((r) => r.canDecide) ?? [];
  const decided = (recent.data ?? [])
    .filter((r) => r.decidedAt && r.employee.id !== session?.employeeId)
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
    .slice(0, 20);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">Leave requests waiting for your decision.</p>
      </div>

      {pending.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {pending.data && waiting.length === 0 && (
        <p className="rounded-lg border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing is waiting for you.
        </p>
      )}

      <div className="space-y-3">
        {waiting.map((r) => <PendingRequest key={r.id} request={r} />)}
      </div>

      {decided.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Decided in {year}</h2>
          <div className="overflow-x-auto rounded-lg border bg-background">
            <table className="w-full text-sm">
              <tbody>
                {decided.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{r.employee.name}</td>
                    <td className="px-4 py-3">{r.leaveType.name}</td>
                    <td className="px-4 py-3">{describeSpan(r)}</td>
                    <td className="px-4 py-3">{showDays(r.days)}</td>
                    <td className="px-4 py-3"><LeaveStatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function PendingRequest({ request: r }: { request: LeaveRequest }) {
  const decide = useDecideLeave();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');

  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium">
            {r.employee.name} <span className="tabular text-xs font-normal text-muted-foreground">{r.employee.empCode}</span>
          </p>
          <p className="text-sm">
            {r.leaveType.name} · {describeSpan(r)} · {showDays(r.days)}
          </p>
          {r.reason && <p className="text-sm text-muted-foreground">&ldquo;{r.reason}&rdquo;</p>}
          <p className="text-xs text-muted-foreground">Asked on {formatDate(toIstDate(new Date(r.createdAt)))}</p>
        </div>

        {!rejecting && (
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ id: r.id, decision: 'APPROVE' })}
            >
              <Check className="h-4 w-4" /> Approve
            </Button>
            <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => setRejecting(true)}>
              <X className="h-4 w-4" /> Reject
            </Button>
          </div>
        )}
      </div>

      {rejecting && (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            decide.mutate({ id: r.id, decision: 'REJECT', note });
          }}
        >
          <Input
            autoFocus
            className="min-w-64 flex-1"
            placeholder="Why — they will see this"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button size="sm" variant="destructive" type="submit" disabled={decide.isPending || !note.trim()}>
            Reject
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setRejecting(false)}>Back</Button>
        </form>
      )}

      {decide.isError && <p className="mt-2 text-sm text-destructive">{decide.error.message}</p>}
    </div>
  );
}
