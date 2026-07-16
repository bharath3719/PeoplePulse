import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * A native <select>, styled to match Input.
 *
 * Deliberately not the Radix listbox shadcn ships: every option list in Slice 1
 * is a short, flat list of org units, and the native control is the one that
 * already works with a keyboard, a screen reader, and an Android browser — which
 * matters, because the mobile app is Android-first (BRD) and NFR-09 is only
 * deferred, not dropped.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive',
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = 'Select';
