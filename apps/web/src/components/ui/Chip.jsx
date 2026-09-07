import { cn } from '@/lib/cn';

/**
 * Pill filter used above game grids and in the category bar.
 *
 * Two variants, both the reference's:
 *
 * `solid` — the brand pill, filled on selection.
 * `tint`  — the search dialog's filters. Selection is a 12% brand wash under
 *           brand text rather than a fill, so a row of them stays quiet
 *           behind the grid it is filtering.
 *
 * Takes `active` plus any native button attribute; everything else is spread
 * straight onto the element.
 */
const VARIANTS = {
  solid: {
    on: 'bg-piccolo text-goten',
    off: 'bg-gohan text-trunks hover:bg-beerus hover:text-bulma',
  },
  tint: {
    on: 'bg-jiren text-piccolo',
    off: 'bg-heles text-bulma hover:bg-beerus',
  },
};

export function Chip({ active, variant = 'solid', className, ...props }) {
  const tone = VARIANTS[variant];

  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full px-4',
        'text-sm font-medium whitespace-nowrap transition-colors cursor-pointer',
        active ? tone.on : tone.off,
        className,
      )}
      {...props}
    />
  );
}
