import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Rocket, X } from 'lucide-react';
import type { Permission } from '@peoplepulse/core';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/features/auth/permissions';
import { useEmployees } from '@/features/employee/api/employees';
import { useHolidays } from '@/features/leave/api/leave';
import { thisLeaveYear } from '@/features/leave/format';
import { useOrg } from '@/features/org/api/org';
import { useAccess } from '@/features/users/api/users';
import { Bar } from './Widget';

interface Step {
  key: string;
  title: string;
  description: string;
  to: string;
  done: boolean;
  loading: boolean;
}

/**
 * Getting a new company to useful, the BRD's "30-minute setup". Each step is
 * judged from what the API already holds — never a flag someone ticks — and
 * offered only to someone who can do it. Gone once every step is done, or when
 * dismissed (per company, in this browser).
 */
export function SetupChecklist() {
  const { can, session } = usePermissions();
  const year = thisLeaveYear();
  const dismissKey = `pp.setup.dismissed.${session?.tenantId ?? ''}`;
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissKey) === '1');

  const employees = useEmployees(undefined, can('employee.view'));
  const org = useOrg(can('org.view'));
  const holidays = useHolidays(year);
  const access = useAccess(can('user.invite'));

  const offer = (permission: Permission | null, step: Step): Step[] =>
    permission === null || can(permission) ? [step] : [];

  const steps: Step[] = [
    ...offer('org.manage', {
      key: 'org', title: 'Set up departments and locations', description: 'So people, holidays and reports can be grouped.',
      to: '/settings', done: (org.data?.departments.length ?? 0) > 0, loading: org.isLoading,
    }),
    ...offer('employee.create', {
      key: 'people', title: 'Add your people', description: 'One at a time, or all at once from Excel.',
      to: '/import', done: (employees.data?.length ?? 0) > 0, loading: employees.isLoading,
    }),
    ...offer('leave.manage', {
      key: 'holidays', title: `Add ${year}’s holidays`, description: 'Leave skips them, and everyone can see what’s coming.',
      to: '/leave/settings', done: (holidays.data?.length ?? 0) > 0, loading: holidays.isLoading,
    }),
    ...offer('user.invite', {
      key: 'invite', title: 'Invite a colleague', description: 'A manager to approve leave, or your accountant.',
      to: '/users', done: (access.data?.members.length ?? 0) > 1 || (access.data?.invitations.length ?? 0) > 0, loading: access.isLoading,
    }),
    ...(session?.mfaRequired
      ? [{
          key: 'mfa', title: 'Turn on two-factor authentication', description: 'Needed before you can change bank details or roles.',
          to: '/security', done: session.mfaEnrolled, loading: false,
        }]
      : []),
  ];

  if (steps.length === 0 || dismissed || steps.some((s) => s.loading)) return null;
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b bg-brand-soft/60 px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-lg bg-primary p-2 text-primary-foreground">
            <Rocket className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Finish setting up your company</h2>
            <p className="text-sm text-muted-foreground">
              {done} of {steps.length} done. Most companies finish in under half an hour.
            </p>
            <Bar value={done} max={steps.length} className="mt-2 w-48" />
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Hide setup steps"
          onClick={() => {
            localStorage.setItem(dismissKey, '1');
            setDismissed(true);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ul className="grid divide-y sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
        {steps.map((s) => (
          // On a phone, only what is left: the done steps cost a screenful.
          <li key={s.key} className={cn(s.done && 'hidden sm:block')}>
            <Link
              to={s.to}
              className={cn('group flex h-full items-start gap-3 px-5 py-4 transition-colors hover:bg-accent/60', s.done && 'opacity-60')}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                  s.done ? 'border-success bg-success text-white' : 'border-input bg-background',
                )}
              >
                {s.done && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm font-medium', s.done && 'line-through decoration-muted-foreground/50')}>{s.title}</span>
                <span className="block text-xs text-muted-foreground">{s.description}</span>
              </span>
              {!s.done && <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
