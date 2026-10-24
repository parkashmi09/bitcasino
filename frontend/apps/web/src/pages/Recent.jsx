import { GameList } from '@/components/sections/GameList';
import { Skeleton } from '@/components/ui/Skeleton';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { useRecentlyPlayed } from '@/hooks/useRecentlyPlayed';

/**
 * `/games/recent` — where the header's `Recents` button goes.
 *
 * It is a PAGE, not a dropdown. That is what the reference has: read from its
 * own header, the control is `<a href="/games/recent">` — the same shape its
 * bell is, and the same shape the sidebar's `Recents` chip is — and pressing
 * it navigates. This project used to open a 320px panel from it, which is why
 * the two behaved nothing alike; the reference has no recents dropdown
 * anywhere. `components/layout/RecentsMenu.jsx` was that panel and is gone.
 *
 * Measured off `bitcasino.io/games/recent` at a 1536px viewport, signed in,
 * by the procedure in `docs/11-comparing-against-the-reference.md`:
 *
 *   page       `grid gap-4`, full content width (1201px)
 *   heading    `Recently played`, 24px/32, weight 400, DM Sans, at y=104 —
 *              flush with the top of the column, no filter bar beside it
 *   grid       the same auto-fitting game grid every listing page uses
 *   crumb      BELOW the grid, `⌂ › Games › Recently played`
 *
 * So the page is `GameList` with no `filter`, which is the whole reason that
 * prop became optional — the reference draws a bare heading here because a
 * play history has no second axis to narrow by, and "most recent first" is
 * the only order that means anything.
 *
 * ## The list is real, and short by design
 *
 * `GET /casino/games/recently-played`, over the session. The platform keeps 15
 * entries per player (`RECENTLY_PLAYED_LIMIT`), so the route's own default is
 * the whole list and `useRecentlyPlayed` sends no `limit` at all.
 *
 * A game that has left the catalogue since it was played comes back with a
 * null `game` — the backend keeps that row deliberately — and is skipped
 * rather than drawn as a broken tile. So a player can have history and still
 * see fewer tiles than they played, which is correct and not a bug.
 */
export function Recent() {
  const { games, status, reload } = useRecentlyPlayed();

  if (status === 'loading' || status === 'idle') return <RecentSkeleton />;

  if (status === 'error') {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="self-end font-primary text-2xl leading-8 font-normal tracking-normal text-bulma">
          Recently played
        </h1>
        <div className="grid gap-2 py-16 text-center">
          <p className="text-sm text-bulma">That list could not be loaded.</p>
          <div>
            <button
              type="button"
              onClick={reload}
              className="cursor-pointer text-sm font-medium text-piccolo hover:underline"
            >
              Try again
            </button>
          </div>
        </div>
        <Breadcrumb items={CRUMB} />
      </div>
    );
  }

  return (
    <GameList
      title="Recently played"
      games={games}
      breadcrumb={CRUMB}
      empty="Nothing played yet. Games you open show up here, so you can pick one back up where you left it."
    />
  );
}

/**
 * `Games` points at the lobby rather than a `/games` index, because there is
 * no such route — the reference's crumb does the same, and its own middle
 * segment is a link back to the home grid.
 */
const CRUMB = [{ label: 'Games', to: '/' }, { label: 'Recently played' }];

/**
 * What stands in while the list is in flight.
 *
 * Tiles, not a spinner: the grid's height is knowable before the data lands —
 * every tile is the same 210:282 the catalogue uses — so the page can be laid
 * out correctly from the first frame and the real tiles drop into place
 * without the crumb jumping down the screen.
 *
 * Eight of them. The platform keeps fifteen, but eight is one full row at the
 * width this page is usually read at, and a skeleton that promises fifteen
 * tiles to a player who has played two is a worse guess than one that
 * promises less than it delivers.
 */
function RecentSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="self-end font-primary text-2xl leading-8 font-normal tracking-normal text-bulma">
        Recently played
      </h1>

      <ul
        aria-hidden="true"
        className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-2 gap-y-3 sm:gap-4 md:grid-cols-[repeat(auto-fill,minmax(7.75rem,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(8.75rem,1fr))]"
      >
        {Array.from({ length: 8 }, (_, index) => (
          <li key={index}>
            <Skeleton className="aspect-[210/282] w-full rounded-i-md" />
          </li>
        ))}
      </ul>

      <Breadcrumb items={CRUMB} />
    </div>
  );
}
