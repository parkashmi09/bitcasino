import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { GameList } from '@/components/sections/GameList';
import { GameGridSkeleton, QueryError } from '@/components/ui/QueryState';
import { categoryLabel } from '@/data/categories';
import { categoryFromType, isCategorySlug, queryTypesFor } from '@/data/adapters/categories';
import { useGames } from '@/queries';
import { useGameCollection } from '@/queries/collections';

const ALL = '';

/** The reference's page size on a category grid. See `limit` below. */
const PAGE_SIZE = 35;

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
 * ## Except the one page that is not fixed to one axis
 *
 * `/categories/live-casino` covers three sub-categories as well as its own
 * type (`SLUG_EXTRA_TYPES` in `data/adapters/categories.js`), so it has a
 * second axis to offer and the reference gives it a third dropdown:
 * `Categories`, `Providers`, `Sort by`, where every other category page shows
 * two. `covers` below is what decides that, and it is derived from the same
 * table the request is, so the filter cannot offer a slice the page does not
 * actually contain.
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
  const [params, setParams] = useSearchParams();
  const [provider, setProvider] = useState(ALL);
  const [subcategory, setSubcategory] = useState(ALL);

  const isCollectionRoute = mode === 'collection';

  /**
   * The sub-categories this page covers, if it covers more than itself.
   *
   * Empty for every page but `/categories/live-casino`, which is the one that
   * aggregates — and that is exactly the page the reference gives a third
   * dropdown to. Its other category pages carry `Providers` and `Sort by`; the
   * live casino one carries `Categories` as well, because it is the only one
   * with anything to narrow to.
   *
   * Derived from `queryTypesFor` rather than listed again here, so the filter
   * and the request can never disagree about what the page contains.
   */
  const covers = useMemo(() => {
    const types = queryTypesFor(slug ?? '');
    if (types.length <= 1) return [];
    return types
      .map(categoryFromType)
      .filter(Boolean)
      /**
       * The page's own slug is dropped, because as an option it would not
       * narrow anything: choosing `Live Casino` on the Live Casino page sends
       * `live-casino`, which expands right back to the union — the same
       * twenty-nine `All Game Categories` already shows. An option that reads
       * as a filter and changes nothing is worse than no option.
       *
       * What that leaves unreachable is the handful of tables typed
       * `live-casino` and nothing more specific — the lobby, and the three
       * placeholder rooms. They have no name of their own to offer, which is
       * exactly why they are the page's own type rather than a slice of it.
       */
      .filter((value) => value !== slug);
  }, [slug]);

  /**
   * The page number lives in `?page=`, as it does on the reference.
   *
   * In the URL rather than in state so that a page of a long category is a
   * thing you can link to, reload and come back to — the reference's own pager
   * is a row of `<a href="?page=n">` for exactly that reason. Ours are buttons
   * (see `ui/Pager.jsx`), but they write the same query string.
   *
   * Clamped at 1 here, and again against `totalPages` in `Pager`: `?page=0`
   * and `?page=abc` are URLs a person can type.
   */
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);

  const goToPage = (next) => {
    const updated = new URLSearchParams(params);
    if (next > 1) updated.set('page', String(next));
    else updated.delete('page');
    setParams(updated);
    // A new page is a new grid; leaving the viewport halfway down the old one
    // lands you in the middle of the new list with no idea you moved.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /**
   * Back to page 1, because narrowing the list makes the old page number
   * meaningless: page 4 of a shorter list is an offset nothing lives at, and
   * the empty grid that follows reads as "this studio has no games" rather
   * than "you are past the end".
   */
  const resetPage = () => {
    const updated = new URLSearchParams(params);
    updated.delete('page');
    setParams(updated);
  };

  const changeProvider = (next) => {
    setProvider(next);
    resetPage();
  };

  /**
   * Narrowing to a sub-category also clears the studio.
   *
   * The two filters are not independent here: the studios offered are the ones
   * present in the list, and switching from Live Casino to Roulette can leave
   * a studio selected that deals no roulette — which returns nothing and reads
   * as a broken page rather than as a filter that no longer applies.
   */
  const changeSubcategory = (next) => {
    setSubcategory(next);
    setProvider(ALL);
    resetPage();
  };

  // A `/games/:slug` that names a category behaves like the category page —
  // `resolveCollection` answers `kind: 'category'` for exactly that case.
  const collection = useGameCollection(isCollectionRoute ? slug : undefined, {
    limit: 100,
  });

  const asCategory = !isCollectionRoute || collection.kind === 'category';

  const categoryQuery = useGames({
    /**
     * Narrowing to a sub-category asks the API for that one type, rather than
     * filtering the union here.
     *
     * It has to go to the API for the same reason the provider filter does,
     * and the comment above says it: a client-side pass only ever sees the
     * thirty-five rows it was handed. Filtering page 1 of Live Casino down to
     * Roulette would show the roulette tables *on that page* and call it the
     * whole list.
     */
    category: subcategory || slug,
    provider: provider || undefined,
    page,
    /**
     * 35, which is the reference's own page size — read off its pager, and
     * fixed: `/categories/baccarat` hands back 35 tiles at 1024px and at
     * 1600px alike, where the grid is four columns wide and eight.
     *
     * A collection is still read whole (`limit: 100` above): a curated row is
     * short by construction and its route takes no `page` worth using.
     */
    limit: PAGE_SIZE,
    enabled: asCategory && isCategorySlug(slug),
  });

  /**
   * A `?page=` past the end is pulled back to the last real page.
   *
   * `?page=99` on a four-page list asks the API for an offset nothing lives
   * at, and it answers correctly: zero rows. The grid then renders the empty
   * state — "No games match this filter yet." — which is a lie about the
   * filter and says nothing about what actually happened.
   *
   * Only reachable by typing or by following a stale link, since `Pager` never
   * offers a page it does not have. `replace` so the bad URL does not become a
   * step in the history to go Back into.
   */
  const totalPages = categoryQuery.data?.pagination?.totalPages;

  useEffect(() => {
    if (!asCategory || !totalPages || page <= totalPages) return;
    const updated = new URLSearchParams(params);
    if (totalPages > 1) updated.set('page', String(totalPages));
    else updated.delete('page');
    setParams(updated, { replace: true });
  }, [asCategory, totalPages, page, params, setParams]);

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

  /**
   * The sub-category options, from what the page covers — not from what the
   * current response happens to contain.
   *
   * Off `covers` rather than off the rows, because once a sub-category is
   * chosen the response only holds that one and the list would collapse to the
   * selection with no way back to another. Same trap as the provider options
   * above, and the reason they carry that `unfiltered` note.
   */
  const subcategoryOptions = useMemo(
    () => [
      { value: ALL, label: 'All Game Categories' },
      ...covers.map((value) => ({ value, label: categoryLabel(value) })),
    ],
    [covers],
  );

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
      <div className="flex flex-col gap-6">
        <div className="h-8" />
        <GameGridSkeleton />
      </div>
    );
  }

  return (
    <GameList
      title={title}
      games={games}
      filters={[
        /* Only the aggregate page gets a Categories dropdown, and only because
           it is the only one with sub-categories to narrow to. `GameList`
           places by area name, so an absent entry simply leaves its cell of
           the bar empty — the other nine pages keep the two-control layout. */
        ...(covers.length
          ? [
              {
                area: 'categories',
                label: 'Categories',
                placeholder: 'All Game Categories',
                options: subcategoryOptions,
                value: subcategory,
                onChange: changeSubcategory,
              },
            ]
          : []),
        {
          area: 'providers',
          label: 'Providers',
          placeholder: 'All Game Providers',
          options: providerOptions,
          value: provider,
          onChange: changeProvider,
        },
      ]}
      /**
       * Only a category page paginates. A collection is read whole, so it has
       * no `totalPages` worth showing — and `Pager` renders nothing for one
       * page anyway, so this is about not claiming a pager exists rather than
       * about hiding one.
       */
      pagination={
        asCategory && categoryQuery.data?.pagination
          ? {
              page,
              totalPages,
              onChange: goToPage,
            }
          : undefined
      }
      breadcrumb={[{ label: 'Games', to: '/' }, { label: title }]}
    />
  );
}
