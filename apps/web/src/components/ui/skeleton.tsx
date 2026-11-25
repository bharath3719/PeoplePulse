import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** The shape of what is loading, instead of the word "Loading…". */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('animate-shimmer rounded-md bg-muted', className)} {...props} />;
}
