import { Skeleton } from './Skeleton';
import { Icon } from './Icon';
import { cn } from '@/lib/cn';

/**
 * The three things every API-backed surface needs: a skeleton, an error with a
 * way out, and an empty state that is distinguishable from both.
 *
 * ## Why the skeletons carry the real geometry
 *
 * A skeleton is only worth having if it is the same size as what replaces it.
 * A generic grey box that is 40px short reflows the page the moment data
 * arrives, which is the layout shift the skeleton was supposed to prevent — it
 * makes the wait *look* shorter while making the arrival worse. So
 * `GameRailSkeleton` uses `GameRail`'s own tile widths
 * (`w-[104px] md:w-[124px] lg:w-[140px]`) and `GameCard`'s own aspect ratio
 * (140/188), and the two must be changed together.
 *
 * ## Why the error surfaces a request id
 *
 * Every failure the platform generates carries `details.requestId`, and the
 * backend logs the same id against the same request. It is the one string that
 * turns "the games did not load" into a line in a log, so it is rendered —
 * quietly, in the smallest type on the page, but rendered. `ApiError` lifts it
 * to `error.requestId`; a network failure has none, and the block is omitted
 * rather than showing an empty label.
 */

/** One tile. `wide` matches `GameCard`'s featured crop above `sm`. */
function CardSkeleton({ wide = false, className }) {
  return (
    <Skeleton
      className={cn(
        'shrink-0 rounded-i-sm',
        wide ? 'aspect-[140/188] sm:aspect-[244/188]' : 'aspect-[140/188]',
        className,
      )}
    />
  );
}

/**
 * A rail, mid-load: the 32px header line, the 20px gap, then tiles.
 *
 * `count` is deliberately more than fits — the row scrolls, and a skeleton
 * that stops short of the fold announces that the real row will be short.
 */
export function GameRailSkeleton({ count = 8, featured = false }) {
  return (
    <section className="py-3" aria-hidden="true">
      <div className="flex h-8 items-center">
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="mt-5 flex gap-3 overflow-hidden">
        {Array.from({ length: count }, (_, i) => (
          <CardSkeleton
            key={i}
            wide={featured}
            className={
              featured
                ? 'w-[104px] sm:w-[244px]'
                : 'w-[104px] md:w-[124px] lg:w-[140px]'
            }
          />
        ))}
      </div>
    </section>
  );
}

/**
 * A grid, mid-load.
 *
 * The track definition is copied from `GameList`'s own `<ul>` rather than
 * approximated with fixed column counts — it is an `auto-fill`/`minmax` grid,
 * so the number of columns depends on the container width, and any fixed
 * `grid-cols-N` here would reflow the moment the real list replaced it.
 */
export function GameGridSkeleton({ count = 18 }) {
  return (
    <div
      className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-2 gap-y-3 sm:gap-4 md:grid-cols-[repeat(auto-fill,minmax(7.75rem,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(8.75rem,1fr))]"
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} className="w-full" />
      ))}
    </div>
  );
}

/** The providers grid, mid-load. Matches `Providers.jsx`'s 28-unit cells. */
export function ProviderGridSkeleton({ count = 12 }) {
  return (
    <ul
      className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6"
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <Skeleton className="h-28 w-full rounded-i-md" />
        </li>
      ))}
    </ul>
  );
}

/**
 * A failed read, with a retry.
 *
 * `onRetry` should be a query's `refetch`. Without one the block still
 * renders — an error the player cannot act on is still an error they need to
 * see, and silently rendering nothing is how a broken rail becomes invisible.
 */
export function QueryError({ error, onRetry, title = 'Could not load this', compact = false }) {
  const requestId = error?.requestId ?? null;
  const message =
    error?.message || 'Something went wrong while loading. Please try again.';

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-i-md bg-gohan text-center',
        compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12',
      )}
    >
      <span className="grid size-10 place-items-center rounded-full bg-beerus text-trunks">
        <Icon name="warning" size={20} />
      </span>

      <div>
        <p className="text-sm font-medium text-bulma">{title}</p>
        <p className="mt-0.5 max-w-md text-xs text-trunks">{message}</p>
      </div>

      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-i-sm bg-beerus px-3 py-1.5 text-xs font-medium text-bulma transition-colors hover:bg-trunks/20"
        >
          Try again
        </button>
      ) : null}

      {/* The one string worth quoting in a bug report. */}
      {requestId ? (
        <p className="mt-1 select-all font-mono text-[10px] leading-4 text-trunks/70">
          {requestId}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A read that succeeded and found nothing.
 *
 * Separate from `QueryError` on purpose: "this studio has no crash games" and
 * "we could not reach the server" are different facts, and a player who is
 * shown the wrong one either retries something that will never change or gives
 * up on something that would have worked.
 */
export function QueryEmpty({ title = 'Nothing here yet', message, compact = false }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-i-md bg-gohan text-center',
        compact ? 'gap-1 px-4 py-6' : 'gap-2 px-6 py-12',
      )}
    >
      <p className="text-sm font-medium text-bulma">{title}</p>
      {message ? <p className="max-w-md text-xs text-trunks">{message}</p> : null}
    </div>
  );
}
