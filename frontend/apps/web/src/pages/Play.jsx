import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryError } from '@/components/ui/QueryState';
import { GamePanel } from '@/components/play/GamePanel';
import { GameInfo } from '@/components/play/GameInfo';
import { ProviderGames } from '@/components/play/ProviderGames';
import { RecentRounds } from '@/components/play/RecentRounds';
import { isPlayable, useGame } from '@/queries';
import { cn } from '@/lib/cn';

/**
 * Game detail — rebuilt around the reference's shareable layout.
 *
 * ## The shell is what the reference builds
 *
 * One column that stretches and a fixed 386px aside once `xl` — the main holds
 * the reference's `p-3 bg-secondary rounded-lg` card (mapped to this project's
 * `bg-gohan`), and the aside holds a phone-only copy of the game info plus
 * "More from {provider}". The shell carries `group/shell` and a `data-view` of
 * `min`/`expanded`/`fullscreen`; the card's toolbar and info rows and the whole
 * aside hide themselves off those — the same named-group selectors the
 * reference uses — so one expanding or fullscreened panel is all that remains.
 *
 * `view` lives here because the shell IS the fullscreen target: the expand and
 * fullscreen toolbar buttons live inside `GamePanel`, and the aside has to
 * disappear with it, so the state has to be above both.
 *
 * ## The game is resolved through search, because there is no read-by-id
 *
 * **The catalogue exposes lists and search, not `GET /games/:uuid`.** So this
 * page asks `GET /games/search?q=<slug>` and picks the exact uuid match out of
 * what comes back — search is a `LIKE` over name and provider, so the query
 * can legitimately return several rows of which one is the game.
 *
 * In practice the cache usually already holds it: every rail and grid on the
 * site stores the same `Game` objects, so arriving here by clicking a tile is
 * warm. This is the cold-load path — a shared link, a refresh — and it is why
 * the missing route is flagged in `docs/10-backend-integration.md` as a
 * candidate backend addition rather than worked around twice.
 *
 * ## Originals keep the pieces the reference does not have
 *
 * The reference serves no in-house games, so its card is one shape for
 * everything. Ours branches on `isPlayable`: a playable original draws
 * `LimboGame` in the card (or `SignInToPlay` for a visitor with no wallet),
 * an unwired original renders the "client not built yet" panel, and an
 * aggregator title gets the Fun/Real launch frame. The pieces the reference
 * has no need for — the mode switch excepted — keep the same shell: the
 * toolbar's like/favourite/info/expand/fullscreen actions sit over every kind
 * of game, and the "game-info-mobile" twin in the aside is what the reference
 * ships for phones.
 */
export function Play() {
  const { slug } = useParams();
  const { data: game, isPending, error, refetch } = useGame(slug);

  const shellRef = useRef(null);
  const [view, setView] = useState('min');

  // The browser owns fullscreen; when the player leaves it (Esc, a provider's
  // own control), the shell must know or the exit button stays pinned.
  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setView((current) => (current === 'fullscreen' ? 'min' : current));
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  if (isPending) return <PlaySkeleton />;

  if (error) {
    return (
      <div className="mx-auto w-full max-w-[99rem] py-6">
        <QueryError error={error} onRetry={refetch} title="Could not load this game" />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="mx-auto w-full max-w-[99rem] py-20 text-center">
        <h1 className="font-secondary text-2xl font-normal text-bulma">Game not found</h1>
        <Link to="/" className="mt-3 inline-block text-sm text-piccolo hover:underline">
          Back to the lobby
        </Link>
      </div>
    );
  }

  /** Enter or leave fullscreen of the shell; the CSS view follows either way,
   *  so a browser that refuses still gets the stripped-down fullscreen look. */
  const setFullscreen = (on) => {
    setView(on ? 'fullscreen' : 'min');
    const element = shellRef.current;
    if (on) {
      element?.requestFullscreen?.().catch?.(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch?.(() => {});
    }
  };

  return (
    <div className="mx-auto w-full max-w-[99rem] overflow-x-clip">
      <div
        ref={shellRef}
        data-view={view}
        className={cn(
          'group/shell grid w-full gap-4 xl:grid-cols-[minmax(0,1fr)_386px]',
          'data-[view=expanded]:xl:grid-cols-1 data-[view=fullscreen]:xl:grid-cols-1',
        )}
      >
        <main className="min-w-0 xl:pb-20">
          <div className="rounded-lg bg-gohan p-3">
            <GamePanel game={game} view={view} onExpand={setView} onFullscreen={setFullscreen} />
          </div>

          {/* Everyone's recent rounds on a playable original, below the card —
              `LAST_BETS_BY_GAME` is public, and a visitor deciding whether to
              sign up is exactly who the feed is for. It renders nothing until
              somebody has played. */}
          {isPlayable(game) && (
            <div className="group-data-[view=expanded]/shell:hidden group-data-[view=fullscreen]/shell:hidden">
              <RecentRounds game={game.event} title={game.title} />
            </div>
          )}
        </main>

        <aside className="group-data-[view=expanded]/shell:hidden group-data-[view=fullscreen]/shell:hidden self-start min-w-0 xl:h-[calc(100svh-6rem)] xl:overflow-y-scroll no-scrollbar">
          <div id="game-info-mobile" className="md:hidden">
            <GameInfo game={game} />
          </div>
          <ProviderGames game={game} />
        </aside>
      </div>
    </div>
  );
}

/**
 * Sized to the page it becomes: the reference's card frame, the toolbar row
 * and the info grid. The frame is the whole reason — it is the tallest thing
 * on the page, and a skeleton that omitted it would let the title jump half a
 * screen when the game arrives.
 */
function PlaySkeleton() {
  return (
    <div className="mx-auto w-full max-w-[99rem]" aria-hidden="true">
      <Skeleton className="aspect-[9/16] w-full rounded-lg bg-gohan max-h-[80svh] min-h-[400px] md:aspect-[1.78]" />
      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex gap-1.5">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
        <div className="ms-auto flex gap-2">
          <Skeleton className="h-10 w-12 rounded-full" />
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>
      </div>
      <div className="mt-8 hidden gap-4 md:flex">
        <Skeleton className="h-[168px] w-[104px] rounded-lg md:h-[200px] md:w-[124px] lg:h-[226px] lg:w-[140px]" />
        <div className="flex-1">
          <Skeleton className="h-7 w-56" />
          <div className="mt-3 flex gap-1.5">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}