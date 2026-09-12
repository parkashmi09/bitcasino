import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GameList } from '@/components/sections/GameList';
import { GameGridSkeleton, QueryError } from '@/components/ui/QueryState';
import { CATEGORIES } from '@/data/categories';
import { useProviderGames } from '@/queries';

const ALL = '';

/**
 * One studio's catalogue, at `/providers/:slug`.
 *
 * The mirror of `Category`: this page is fixed to a provider, so the dropdown
 * it offers is the category one — "All Game Categories" — exactly as the
 * reference's provider pages do it. Both pages otherwise share `GameList`,
 * because the reference gives them identical chrome.
 *
 * ## Three states that must not be collapsed into two
 *
 * `useProviderGames` resolves the URL slug against the studio list before it
 * can ask for anything, because `gis_providers` has no slug column and
 * `GET /games/provider/:provider` takes the NAME. That makes three outcomes:
 *
 * - **pending** — the studio list has not arrived. Skeleton.
 * - **notFound** — it arrived and holds no such slug. "Provider not found".
 * - **empty** — the studio exists and has no games in the chosen category.
 *
 * Collapsing the last two tells a player a studio does not exist when it does,
 * which is why the empty case stays inside `GameList` (as its `empty` copy)
 * rather than falling through to the not-found panel.
 *
 * ## The category filter narrows what is already fetched
 *
 * `?type=` is sent to the API, so switching the dropdown is a new request
 * rather than a client-side filter — that is what keeps the page correct once
 * a studio has more games than one page holds. The dropdown's OPTIONS are cut
 * from the games currently on screen, so a category with nothing in it is
 * never offered; on a paginated catalogue that under-reports, and the honest
 * fix is a per-provider `stats` route the platform does not have.
 */
export function Provider() {
  const { slug } = useParams();
  const [category, setCategory] = useState(ALL);

  const { provider, games, isPending, notFound, error, refetch } = useProviderGames(slug, {
    category: category || undefined,
    limit: 100,
  });

  const categoryOptions = useMemo(() => {
    const present = new Set((games ?? []).map((game) => game.category));
    return [
      { value: ALL, label: 'All Game Categories' },
      // While a category filter is applied the list only contains that
      // category, so the options would collapse to the one selected and there
      // would be no way back to another. Every category stays offered once a
      // filter is on.
      ...CATEGORIES.filter((c) => category !== ALL || present.has(c.slug)).map((c) => ({
        value: c.slug,
        label: c.label,
      })),
    ];
  }, [games, category]);

  if (notFound) {
    return (
      <div className="py-20 text-center">
        <h1 className="font-secondary text-2xl font-normal text-bulma">
          Provider not found
        </h1>
        <Link to="/providers" className="mt-3 inline-block text-sm text-piccolo hover:underline">
          Back to all providers
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-6">
        <QueryError
          error={error}
          onRetry={refetch}
          title="Could not load this studio"
        />
      </div>
    );
  }

  if (isPending || !provider) {
    return (
      <div className="flex flex-col gap-6 py-2">
        <div className="h-8" />
        <GameGridSkeleton />
      </div>
    );
  }

  return (
    <GameList
      title={provider.name}
      games={games ?? []}
      filter={{
        label: 'Categories',
        placeholder: 'All Game Categories',
        options: categoryOptions,
        value: category,
        onChange: setCategory,
      }}
      empty={`${provider.name} has no games in this category.`}
      breadcrumb={[{ label: 'Providers', to: '/providers' }, { label: provider.name }]}
    />
  );
}
