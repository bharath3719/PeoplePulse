import { cn } from '@/lib/utils';
import type { LeaveStatus } from './api/leave';

const LABEL: Record<LeaveStatus, string> = {
  PENDING: 'Waiting',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/**
 * Four states, told apart by more than colour: the word is always there, so the
 * badge reads the same to someone who cannot see the difference between green
 * and orange.
 */
export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        status === 'APPROVED' && 'border-leave-approved/30 bg-leave-approved/10 text-leave-approved',
        status === 'PENDING' && 'border-leave-pending/30 bg-leave-pending/10 text-leave-pending',
        status === 'REJECTED' && 'border-destructive/30 bg-destructive/10 text-destructive',
        status === 'CANCELLED' && 'border-border bg-muted text-muted-foreground',
      )}
    >
      {LABEL[status]}
    </span>
  );
}
