import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A labelled form field with its error message.
 *
 * The error is rendered by the SAME component that renders the label, so an
 * input can never end up with a validation message that is visually orphaned
 * from it — which is the usual way form errors get lost.
 */
export function Field({
  label,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="text-sm font-medium leading-none">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}
