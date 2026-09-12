import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GameList } from '@/components/sections/GameList';
import { GameGridSkeleton, QueryError } from '@/components/ui/QueryState';
import { categoryLabel } from '@/data/categories';
import { isCategorySlug } from '@/data/adapters/categories';
import { useGames } from '@/queries';
import { useGameCollection } from '@/queries/collections';

const ALL = '';

/**
 * Game listing for a category (`/categories/:slug`) or a curated collection
 * (`/games/:slug`).
 *
 * ## `mode` is a prop, not something inferred from the slug
 *
 * `live-casino` and `crash` are BOTH a category and one of the platform's five
 * curated collections, and they mean different things — the collection is a
 * row an operator picked, the category is every game of that type. Guessing
 * from the slug would make one of the two routes permanently unreachable, so
 * `App.jsx` says which route was matched.
 *
 * ## The page is already fixed to one axis, so it filters by the other
 *
 * As on the reference, a category page's dropdown is the provider one. Only
 * studios with a game in this list are offered, so the filter can never return
 * nothing.
 *
 * The provider filter goes to the API on a category page (`?provider=`) and is
 * applied client-side on a collection page — a curated collection takes `page`
 * and `limit` and **nothing else**, so `?provider=` there is a 422 rather than
 * a narrower list. The collection is read whole and filtered here, which is
 * correct because a curated row is short by construction.
 *
 * @param {{mode: 'category' | 'collection'}} props
 */
export function Category({ mode = 'category' }) {
  const { slug } = useParams();
  const [provider, setProvider] = useState(ALL);

  const isCollectionRoute = mode === 'collection';

  // A `/games/:slug` that names a category behaves like the category page —
  // `resolveCollection` answers `kind: 'category'` for exactly that case.
  const collection = useGameCollection(isCollectionRoute ? slug : undefined, {
    limit: 100,
  });

  const asCategory = !isCollectionRoute || collection.kind === 'category';

  const categoryQuery = useGames({
    category: slug,
    provider: provider || undefined,
    limit: 100,
    enabled: asCategory && isCategorySlug(slug),
  });

  const pending = asCategory ? categoryQuery.isPending : collection.isPending;
  const error = asCategory ? categoryQuery.error : collection.error;
  const refetch = asCategory ? categoryQuery.refetch : collection.refetch;

  const inList = asCategory ? categoryQuery.data?.games : collection.games;

  /**
   * A collection is filtered here; a category was filtered by the API.
   *
   * Applying the provider filter twice on a category page would be harmless
   * but wasteful, and it would go wrong the moment the API paginates: the
   * client-side pass only sees the page it was handed.
   */
  const games = useMemo(() => {
    if (!inList) return undefined;
    if (asCategory || provider === ALL) return inList;
    return inList.filter((game) => game.provider === provider);
  }, [inList, asCategory, provider]);

  /**
   * The studios present in this list.
   *
   * On a category page the list has already been narrowed by `?provider=`, so
   * once a filter is on it would collapse to the one selected and there would
   * be no way back to another. `unfiltered` is the list before that narrowing;
   * it is only available when no filter is applied, so the options are
   * remembered from the last unfiltered render.
   */
  const providerOptions = useMemo(() => {
    const present = [...new Set((inList ?? []).map((game) => game.provider))].sort();
    return [
      { value: ALL, label: 'All Game Providers' },
      ...(provider !== ALL && !present.includes(provider) ? [{ value: provider, label: provider }] : []),
      ...present.map((name) => ({ value: name, label: name })),
    ];
  }, [inList, provider]);

  const title = asCategory
    ? slug
      ? categoryLabel(slug)
      : 'All games'
    : collection.label;

  // A `/games/:slug` that is neither a collection, a cut, nor a category.
  if (isCollectionRoute && collection.notFound) {
    return (
      <div className="py-20 text-center">
        <h1 className="font-secondary text-2xl font-normal text-bulma">
          List not found
        </h1>
        <Link to="/" className="mt-3 inline-block text-sm text-piccolo hover:underline">
          Back to the lobby
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-6">
        <QueryError error={error} onRetry={refetch} title={`Could not load ${title ?? 'this list'}`} />
      </div>
    );
  }

  if (pending || !games) {
    return (
      <div className="flex flex-col gap-6 py-2">
        <div className="h-8" />
        <GameGridSkeleton />
      </div>
    );
  }

  return (
    <GameList
      title={title}
      games={games}
      filter={{
        label: 'Providers',
        placeholder: 'All Game Providers',
        options: providerOptions,
        value: provider,
        onChange: setProvider,
      }}
      breadcrumb={[{ label: 'Games', to: '/' }, { label: title }]}
    />
  );
}
