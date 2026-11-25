import { Link } from 'react-router-dom';
import { Check, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui/avatar';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useDecideLeave, usePendingDecisions } from '@/features/leave/api/leave';
import { describeSpan, problem, showDays } from '@/features/leave/format';
import { RowsSkeleton, Widget } from './Widget';

const SHOWN = 5;

/**
 * Leave waiting on this person's decision, approvable in place. Rejecting needs
 * a reason (the person is deciding whether to come to work), so it happens on
 * the Approvals page, which asks for one. The server checks the balance again
 * on approval, whatever this list showed.
 */
export function ApprovalsInbox() {
  const pending = usePendingDecisions(true);
  const decide = useDecideLeave();
  const rows = pending.data ?? [];

  return (
    <Widget
      title="Needs your decision"
      icon={Inbox}
      link={rows.length > 0 ? { to: '/leave/approvals', label: rows.length > SHOWN ? `All ${rows.length}` : 'Open approvals' } : undefined}
    >
      {pending.isLoading ? (
        <RowsSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState compact icon={Check} title="You’re all caught up" description="New leave requests from your team will show up here." />
      ) : (
        <ul className="-mx-2 divide-y">
          {rows.slice(0, SHOWN).map((r) => {
            const busy = decide.isPending && decide.variables?.id === r.id;
            return (
              <li key={r.id} className="flex items-center gap-3 px-2 py-3">
                <Avatar name={r.employee.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <span className="font-medium">{r.employee.name}</span>
                    <span className="text-muted-foreground"> · {r.leaveType.name}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {describeSpan(r)} · {showDays(r.days)}
                    {r.reason && <> · “{r.reason}”</>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Link to="/leave/approvals" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                    Review
                  </Link>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate(
                        { id: r.id, decision: 'APPROVE' },
                        {
                          onSuccess: () => toast.success(`Approved ${r.employee.name.split(' ')[0]}’s ${r.leaveType.name.toLowerCase()}`),
                          onError: (e) => toast.error(problem(e)),
                        },
                      )
                    }
                  >
                    <Check className="h-3.5 w-3.5 text-success" />
                    {busy ? 'Approving…' : 'Approve'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Widget>
  );
}
