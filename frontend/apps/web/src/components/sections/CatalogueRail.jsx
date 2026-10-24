import { GameRail } from './GameRail';
import { GameRailSkeleton, QueryError } from '@/components/ui/QueryState';
import { useRail } from '@/queries/collections';

/**
 * One home rail, fetching its own games.
 *
 * Each rail owns its request rather than the page fetching seven lists and
 * rendering when they have all landed. Two reasons, and the second is the one
 * that matters:
 *
 * - The rails arrive as they resolve, so the page fills top-down instead of
 *   sitting on skeletons until the slowest collection answers.
 * - **One failed rail does not take the page down.** They are seven
 *   independent reads; a curated row that 500s should leave the other six
 *   rendering, and that is only possible if the failure is scoped to the
 *   component that asked for it.
 *
 * `GameRail` returns null for an empty list, which is what the reference does
 * with a rail it has nothing for — so an empty curated collection draws
 * nothing rather than a heading over a blank strip. That is deliberately NOT
 * true of the error state: a rail that failed says so, because silence would
 * be indistinguishable from a rail an operator emptied on purpose.
 */
export function CatalogueRail({ title, href, source, featured = false }) {
  const { games, isPending, error, refetch } = useRail(source, {
    // 12 was the old static rail length and is what the reference shows before
    // the row runs out of scroll.
    limit: 12,
  });

  if (isPending) return <GameRailSkeleton featured={featured} />;

  if (error) {
    return (
      <section className="py-3">
        <h2 className="mb-3 font-secondary text-xl font-light leading-8 text-bulma md:text-2xl">
          {title}
        </h2>
        <QueryError
          compact
          error={error}
          onRetry={refetch}
          title={`Could not load ${title}`}
        />
      </section>
    );
  }

  return <GameRail title={title} href={href} games={games ?? []} featured={featured} />;
}
