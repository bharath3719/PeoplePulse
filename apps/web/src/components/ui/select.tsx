import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { controlClasses } from './input';

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
    <select ref={ref} className={cn(controlClasses, 'pr-8', className)} {...props} />
  ),
);
Select.displayName = 'Select';
