import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, CalendarPlus, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Can, usePermissions } from '@/features/auth/permissions';
import { ApplyLeave } from './ApplyLeave';
import { BalanceCards } from './BalanceCards';
import { LeaveStatusBadge } from './LeaveStatusBadge';
import { useCancelLeave, useLeaveRequests } from './api/leave';
import { describeSpan, showDays, thisLeaveYear } from './format';

/**
 * Your leave: what you have, what you have asked for, and the form to ask (LVE-05).
 *
 * Every number here comes from the server. The balance is the ledger's sum; the
 * page never adds anything up, so it cannot disagree with what payroll will read.
 */
export function MyLeave() {
  const { session } = usePermissions();
  const navigate = useNavigate();
  const year = thisLeaveYear();
  const [applying, setApplying] = useState(false);
  const employeeId = session?.employeeId ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leave</h1>
          <p className="text-sm text-muted-foreground">Your balances for {year}, and what you have asked for.</p>
        </div>
        <div className="flex items-center gap-2">
          <Can I="leave.approve">
            <Button variant="outline" onClick={() => navigate('/leave/approvals')}>
              <CalendarCheck className="h-4 w-4" /> Approvals
            </Button>
          </Can>
          <Can I="leave.manage">
            <Button variant="outline" onClick={() => navigate('/leave/settings')}>
              <Settings2 className="h-4 w-4" /> Leave policy
            </Button>
          </Can>
          {employeeId && !applying && (
            <Button onClick={() => setApplying(true)}>
              <CalendarPlus className="h-4 w-4" /> Apply for leave
            </Button>
          )}
        </div>
      </div>

      {!employeeId ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Your login isn&apos;t linked to an employee record, so there is no leave to show or apply for.
          </CardContent>
        </Card>
      ) : (
        <>
          {applying && <ApplyLeave onDone={() => setApplying(false)} />}
          <BalanceCards employeeId={employeeId} year={year} />
          <MyRequests year={year} employeeId={employeeId} />
        </>
      )}
    </div>
  );
}

function MyRequests({ year, employeeId }: { year: number; employeeId: string }) {
  const requests = useLeaveRequests({ year });
  const cancel = useCancelLeave();
  // The list holds everything this login may see — a manager's team too.
  const mine = requests.data?.filter((r) => r.employee.id === employeeId) ?? [];

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Your requests</h2>
      {requests.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {requests.data && mine.length === 0 && (
        <p className="rounded-lg border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing requested for {year} yet.
        </p>
      )}
      {mine.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                {['Dates', 'Type', 'Days', 'Status', ''].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium">{describeSpan(r)}</p>
                    {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                  </td>
                  <td className="px-4 py-3">{r.leaveType.name}</td>
                  <td className="px-4 py-3">{showDays(r.days)}</td>
                  <td className="px-4 py-3">
                    <LeaveStatusBadge status={r.status} />
                    {r.decisionNote && <p className="mt-1 text-xs text-muted-foreground">{r.decisionNote}</p>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.canCancel && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(r.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cancel.isError && <p className="text-sm text-destructive">{cancel.error.message}</p>}
    </section>
  );
}
