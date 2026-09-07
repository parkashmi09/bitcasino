import { cn } from '@/lib/cn';

export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-i-md bg-beerus', className)} />;
}
