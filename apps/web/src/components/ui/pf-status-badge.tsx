import { cn } from '@/lib/utils';

/**
 * PF status, made legible at a glance in a list of 200 people.
 *
 * These are THREE DIFFERENT FACTS, not three shades of the same one, and the UI
 * has to say so — because the first question HR asks is "why did this person
 * get no PF?", and the answer is different in each case:
 *
 *   MEMBER          contributing.
 *   EXCLUDED        the company HAS a PF scheme, and this person is out of it:
 *                   they joined above the Rs 15,000 ceiling with no prior
 *                   membership. HR can opt them in.
 *   NOT_APPLICABLE  the company has NO PF scheme at all. Nobody here has PF, and
 *                   there is nothing to opt into.
 *
 * Rendering these as one grey "no PF" badge would destroy exactly the
 * distinction ADR-004 exists to preserve.
 */
const STATUS = {
  MEMBER: {
    label: 'PF member',
    className: 'bg-status-member/10 text-status-member border-status-member/20',
    title: 'Contributing to EPF.',
  },
  EXCLUDED: {
    label: 'PF excluded',
    className: 'bg-status-excluded/10 text-status-excluded border-status-excluded/20',
    title:
      'The company has an EPF scheme, but this employee is outside it — they joined above the ₹15,000 wage ceiling with no prior PF membership. They can be opted in.',
  },
  NOT_APPLICABLE: {
    label: 'No PF scheme',
    className: 'bg-status-notApplicable/10 text-status-notApplicable border-status-notApplicable/20',
    title:
      'This company is not registered for EPF, so no employee has PF. Register the company in Settings to enable it.',
  },
} as const;

export type PfStatus = keyof typeof STATUS;

export function PfStatusBadge({ status }: { status: string }) {
  const config = STATUS[status as PfStatus] ?? STATUS.NOT_APPLICABLE;

  return (
    <span
      title={config.title}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}

const ESI_LABEL: Record<string, string> = {
  COVERED: 'ESI covered',
  NOT_COVERED: 'Above ESI limit',
  NOT_APPLICABLE: 'No ESI scheme',
};

export function EsiStatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {ESI_LABEL[status] ?? status}
    </span>
  );
}
