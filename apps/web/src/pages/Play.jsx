import { Link, useParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { GameRail } from '@/components/sections/GameRail';
import { QueryError } from '@/components/ui/QueryState';
import { LimboGame } from '@/components/play/LimboGame';
import { ProviderFrame } from '@/components/play/ProviderFrame';
import { RecentRounds } from '@/components/play/RecentRounds';
import { categoryLabel } from '@/data/categories';
import { isPlayable, useGame, useGames } from '@/queries';
import { useAuth } from '@/auth/AuthProvider';

/**
 * Game detail. The frame it renders depends on what kind of game this is, and
 * the three cases are genuinely different rather than three states of one.
 *
 * ## Three frames, not one with flags
 *
 * | | Frame | Money moves |
 * | --- | --- | --- |
 * | An original this client draws | `LimboGame` | socket round on casino-service |
 * | An original it does not yet | a plain "not wired up" panel | nothing |
 * | An aggregator title | `ProviderFrame` | inside the provider's iframe |
 *
 * The middle row is the honest half of `parameters.inHouse`: the catalogue
 * says a game is an original, the backend implements twenty of them, and this
 * client draws one. Falling back to the provider frame for the other
 * nineteen would offer a Fun/Real pair that launches nothing, and falling
 * back to nothing would hide games that genuinely exist.
 *
 * Which originals are drawable is `IN_HOUSE_EVENTS` in `queries/play.js`, and
 * `isPlayable` is the one place that decision is made.
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
 * ## "Similar games" is the category, minus this one
 *
 * A recommendation endpoint does not exist either, and inventing similarity
 * from RTP or provider would be a claim the catalogue cannot support. Same
 * category is the honest version of "similar", and it is what the rail's
 * heading has always meant here.
 */
export function Play() {
  const { slug } = useParams();
  const { status } = useAuth();
  const { data: game, isPending, error, refetch } = useGame(slug);

  // Waits for the game, because the category it needs comes from it.
  const similar = useGames({
    category: game?.category ?? undefined,
    limit: 24,
    enabled: Boolean(game?.category),
  });

  if (isPending) return <PlaySkeleton />;

  if (error) {
    return (
      <div className="py-6">
        <QueryError error={error} onRetry={refetch} title="Could not load this game" />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="py-20 text-center">
        <h1 className="font-secondary text-2xl font-normal text-bulma">Game not found</h1>
        <Link to="/" className="mt-3 inline-block text-sm text-piccolo hover:underline">
          Back to the lobby
        </Link>
      </div>
    );
  }

  const others = (similar.data?.games ?? []).filter((other) => other.id !== game.id);

  return (
    <div className="py-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-trunks">
          <Link to="/" className="hover:text-piccolo">Lobby</Link>
          {/* A game whose upstream `type` we do not map has a null category —
              it still plays, it just has no category page to link back to. */}
          {game.category && (
            <>
              <Icon name="chevron-right" size={12} />
              <Link to={`/categories/${game.category}`} className="hover:text-piccolo">
                {categoryLabel(game.category)}
              </Link>
            </>
          )}
        </div>

        {isPlayable(game) ? (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div>
                <h1 className="font-secondary text-lg font-medium text-bulma">{game.title}</h1>
                <p className="text-xs text-trunks">{game.provider}</p>
              </div>
            </div>
            <div className="mt-3">
              {/* A round debits a wallet, so there is nothing to render for a
                  visitor who has none. The panel is not shown disabled: every
                  control on it would be inert and the stake field would be
                  asking about a balance that does not exist. */}
              {status === 'authenticated' ? (
                <LimboGame game={game} />
              ) : (
                <SignInToPlay title={game.title} />
              )}
            </div>

            {/* Everyone's recent rounds on this game, signed in or not —
                `LAST_BETS_BY_GAME` is public, and a visitor deciding
                whether to sign up is exactly who the feed is for. It
                renders nothing until somebody has played. */}
            <RecentRounds game={game.event} title={game.title} />
          </>
        ) : game.inHouse ? (
          <>
            <div className="mt-3 grid aspect-video w-full place-items-center rounded-s-md bg-popo px-6 text-center">
              <div>
                <span className="mx-auto grid size-16 place-items-center rounded-full bg-goten/10 text-goten">
                  <Icon name="bolt" size={28} />
                </span>
                <p className="mt-4 font-secondary text-lg font-medium text-goten">{game.title}</p>
                {/* Specific about which half is missing. The engine plays this
                    game today — `in-house` implements all twenty — and what is
                    absent is a client that can draw it. Saying "coming soon"
                    would describe the wrong side. */}
                <p className="mx-auto mt-1 max-w-[380px] text-xs leading-relaxed text-goten/60">
                  This original runs on the platform already. The client for it is not
                  built yet — Limbo is the one wired up so far.
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div>
                <h1 className="font-secondary text-lg font-medium text-bulma">{game.title}</h1>
                <p className="text-xs text-trunks">{game.provider}</p>
              </div>
            </div>
          </>
        ) : (
          <ProviderFrame game={game} />
        )}
      </div>

      {others.length > 0 && (
        <div className="mt-6">
          <GameRail
            title="Similar games"
            href={`/categories/${game.category}`}
            games={others}
          />
        </div>
      )}
    </div>
  );
}

/** A playable original, to a visitor who has no wallet to play it from. */
function SignInToPlay({ title }) {
  return (
    <div className="grid aspect-video w-full place-items-center rounded-s-md bg-popo px-6 text-center">
      <div>
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-piccolo text-goten">
          <Icon name="play" size={28} className="ms-1" />
        </span>
        <p className="mt-4 font-secondary text-lg font-medium text-goten">{title}</p>
        <p className="mt-1 text-xs text-goten/60">Log in to play a round.</p>
        <Link
          to="/login"
          className="mt-4 inline-flex h-10 items-center rounded-i-sm bg-piccolo px-4 text-sm font-medium text-goten transition-opacity hover:opacity-90"
        >
          Log in
        </Link>
      </div>
    </div>
  );
}

/**
 * Sized to the page it becomes: the breadcrumb line, the 16:9 frame, and the
 * title row. The frame is the whole reason — it is the tallest thing on the
 * page, and a skeleton that omitted it would let the title jump half a screen
 * when the game arrives.
 */
function PlaySkeleton() {
  return (
    <div className="py-4" aria-hidden="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 aspect-video w-full rounded-s-md" />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-28" />
        </div>
        <div className="ms-auto flex gap-2">
          <Skeleton className="h-10 w-28 rounded-i-sm" />
          <Skeleton className="h-10 w-28 rounded-i-sm" />
        </div>
      </div>
    </div>
  );
}
