import { cn } from '@/lib/cn';

/**
 * Pill filter used above game grids and in the category bar.
 *
 * Takes `active` plus any native button attribute; everything else is spread
 * straight onto the element.
 */
export function Chip({ active, className, ...props }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full px-4',
        'text-sm font-medium whitespace-nowrap transition-colors cursor-pointer',
        active
          ? 'bg-piccolo text-goten'
          : 'bg-gohan text-trunks hover:bg-beerus hover:text-bulma',
        className,
      )}
      {...props}
    />
  );
}
