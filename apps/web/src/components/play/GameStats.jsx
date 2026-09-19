import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { gameMetrics } from './playMetrics';

/**
 * The play page's stats surface: a desktop popover behind the info button and
 * a mobile accordion that takes over below the point where the toolbar buttons
 * stop fitting.
 *
 * The reference renders the same numbers in a Radix popover and in a mobile
 * accordion (`max-[420px]`); the two share one row builder (`gameMetrics`, in
 * `playMetrics.js`) so the figures cannot drift apart — that module also feeds
 * the SEO section's table in `GameInfo`.
 */

/** The rows as a labelled list — shared by the popover and the accordion. */
function GameStatsPanel({ rows }) {
  return (
    <dl className="grid gap-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="text-xs text-trunks">{label}</dt>
          <dd className="text-end text-sm text-bulma tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The info button and its popover. Below 420px the accordion takes over and the
 * button hides (`max-[420px]:hidden`); below `md` it hides as well (`hidden`),
 * because the toolbar's right cluster does not have room for another round
 * button until the panel is wider — between 420px and `md` neither surface
 * shows, which matches the reference keeping the number a popover-only feature.
 */
export function GameStatsPopover({ game }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (root.current && !root.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        data-testid="info-button"
        aria-expanded={open}
        aria-label="Game info"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'hidden h-10 w-10 items-center justify-center rounded-full text-trunks transition-colors hover:text-bulma',
          'max-[420px]:hidden md:flex',
        )}
      >
        <Icon name="info" size={18} />
      </button>

      {open && (
        <div className="absolute end-0 top-full z-40 mt-2 w-72 rounded-lg border border-beerus bg-gohan p-4 shadow-xl">
          <h3 className="font-secondary text-sm font-medium text-bulma">Game stats</h3>
          <div className="mt-3">
            <GameStatsPanel rows={gameMetrics(game)} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The accordion the toolbar's info button hands off to below 420px. The
 * reference renders it inside the same card, below the toolbar, visible only
 * there (`max-[420px]:block!`) — this is the same surface, not a second one.
 */
export function GameStatsAccordion({ game, className }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('hidden max-[420px]:block', className)}>
      <div className="mt-4 flex items-center justify-between border-t border-beerus pt-4">
        <span className="text-sm font-medium text-bulma">Game stats</span>
        <button
          type="button"
          data-testid="info-accordion-trigger"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 text-xs font-medium text-trunks transition-colors hover:text-bulma"
        >
          {open ? 'Hide' : 'Show'}
          <Icon name="chevron-down" size={16} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <div className="mt-3">
          <GameStatsPanel rows={gameMetrics(game)} />
        </div>
      )}
    </div>
  );
}