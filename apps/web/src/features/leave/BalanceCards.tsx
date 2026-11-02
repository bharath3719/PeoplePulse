import { ApiError } from '@/lib/api';
import { useLeaveBalances, type LeaveBalance } from './api/leave';
import { figure, showDays, unit } from './format';

/**
 * One card per leave type: what can be taken now, and how that was arrived at.
 * Used on your own leave page and on an employee's profile.
 */
export function BalanceCards({ employeeId, year }: { employeeId: string; year: number }) {
  const balances = useLeaveBalances(employeeId, year);

  if (balances.isLoading) return <p className="text-sm text-muted-foreground">Loading balances…</p>;
  if (balances.isError) {
    return (
      <p className="text-sm text-destructive">
        {balances.error instanceof ApiError && balances.error.status === 404
          ? 'You can’t see this person’s leave.'
          : 'Couldn’t load leave balances.'}
      </p>
    );
  }
  if (!balances.data?.length) {
    return <p className="text-sm text-muted-foreground">No leave types are set up yet.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {balances.data.map((b) => <BalanceCard key={b.leaveType.id} balance={b} />)}
    </div>
  );
}

/** The big number in tabular figures; the unit in the body face, so it reads as a word. */
function Figure({ days }: { days: number }) {
  return (
    <p className="mt-2">
      <span className="tabular text-2xl font-semibold">{figure(days)}</span>{' '}
      <span className="text-sm text-muted-foreground">{unit(days)}</span>
    </p>
  );
}

function BalanceCard({ balance: b }: { balance: LeaveBalance }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{b.leaveType.name}</p>
        <p className="tabular text-xs text-muted-foreground">{b.leaveType.code}</p>
      </div>

      {b.leaveType.isPaid ? (
        <>
          <Figure days={b.availableDays ?? 0} />
          <p className="text-xs text-muted-foreground">
            available
            {b.pendingDays > 0 && <> · {showDays(b.pendingDays)} waiting for approval</>}
            {' '}· {showDays(b.takenDays)} taken
          </p>
        </>
      ) : (
        <>
          <Figure days={b.takenDays} />
          <p className="text-xs text-muted-foreground">
            taken this year, unpaid
            {b.pendingDays > 0 && <> · {showDays(b.pendingDays)} waiting</>}
          </p>
        </>
      )}
    </div>
  );
}
