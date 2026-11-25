import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** One card on Home: a titled box with an optional "see all" link. */
export function Widget({
  title,
  icon: Icon,
  link,
  action,
  children,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  link?: { to: string; label: string };
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          {title}
        </h2>
        {action}
        {link && (
          <Link
            to={link.to}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            {link.label} <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="flex-1 px-5 pb-5">{children}</div>
    </Card>
  );
}

/** The shape of a list while it loads. */
export function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A thin horizontal bar, `value` of `max`. SVG, so its length is an attribute and not a style. */
export function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" className={cn('h-1.5 w-full', className)}>
      <rect width="100" height="6" rx="3" className="fill-muted" />
      <rect width={pct} height="6" rx="3" className="fill-primary" />
    </svg>
  );
}
