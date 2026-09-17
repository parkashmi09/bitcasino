import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GameList } from '@/components/sections/GameList';
import { GameGridSkeleton, QueryError } from '@/components/ui/QueryState';
import { categoryLabel } from '@/data/categories';
import { useTheme } from '@/queries';

const ALL = '';

/**
 * A curated theme at `/themes/:slug` — the reference's third list space,
 * beside `/categories/:slug` and `/games/:slug`.
 *
 * ## Why this is not `Category` with a third `mode`
 *
 * `Category` is fixed to one axis and filters by the other: a category page
 * knows its type and offers the provider dropdown. A theme is fixed to
 * **neither**. `Live Exclusives` is seven Evolution tables that are baccarat,
 * blackjack and roulette at once, so the reference gives this page BOTH
 * dropdowns — `Categories`, `Providers`, `Sort by`, in that order — and both
 * of them narrow the same seven rather than one going to the API.
 *
 * That is the whole difference, and it is the difference the file exists for:
 * a `mode="theme"` inside `Category` would have to disable the `?provider=`
 * request, add a second filter the other two modes never show, and skip the
 * `isCategorySlug` guard. Three branches through one component is harder to
 * read than two components.
 *
 * ## Both filters are client-side, and they have to be
 *
 * A theme is a named set of games (`data/adapters/themes.js`), read out of one
 * page of the catalogue. There is no `?theme=` to narrow further with, so
 * asking the API for `?provider=Evolution` would return every Evolution game
 * rather than the theme's — the filter has to run over the cut, not before it.
 * The list is seven rows, so this costs nothing.
 *
 * Options are the values actually present, exactly as on the reference: its
 * own Categories dropdown on this page lists the types its seven games have
 * and nothing else, so a filter can never return an empty grid.
 */
export function Theme() {
  const { slug } = useParams();
  const [category, setCategory] = useState(ALL);
  const [provider, setProvider] = useState(ALL);

  const theme = useTheme(slug);
  const inList = theme.games;

  const games = useMemo(() => {
    if (!inList) return undefined;
    return inList.filter(
      (game) =>
        (category === ALL || game.category === category) &&
        (provider === ALL || game.provider === provider),
    );
  }, [inList, category, provider]);

  /**
   * The two option lists, built off the UNFILTERED theme.
   *
   * Off `inList` rather than off `games`, or picking a studio would empty the
   * category dropdown of everything that studio does not run and there would
   * be no way back — the pair have to describe the theme, not each other's
   * current answer.
   */
  const categoryOptions = useMemo(() => {
    const present = [...new Set((inList ?? []).map((game) => game.category))]
      .filter(Boolean)
      .sort();
    return [
      { value: ALL, label: 'All Game Categories' },
      ...present.map((value) => ({ value, label: categoryLabel(value) })),
    ];
  }, [inList]);

  const providerOptions = useMemo(() => {
    const present = [...new Set((inList ?? []).map((game) => game.provider))].sort();
    return [
      { value: ALL, label: 'All Game Providers' },
      ...present.map((value) => ({ value, label: value })),
    ];
  }, [inList]);

  // A `/themes/:slug` this site does not serve. Distinct from a theme that
  // resolved and whose games are all missing from the catalogue: the first is
  // a wrong URL, the second is a seeding problem, and they read differently.
  if (theme.notFound) {
    return (
      <div className="py-20 text-center">
        <h1 className="font-secondary text-2xl font-normal text-bulma">List not found</h1>
        <Link to="/" className="mt-3 inline-block text-sm text-piccolo hover:underline">
          Back to the lobby
        </Link>
      </div>
    );
  }

  if (theme.error) {
    return (
      <div className="py-6">
        <QueryError
          error={theme.error}
          onRetry={theme.refetch}
          title={`Could not load ${theme.label}`}
        />
      </div>
    );
  }

  if (theme.isPending || !games) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-8" />
        <GameGridSkeleton />
      </div>
    );
  }

  return (
    <GameList
      title={theme.label}
      games={games}
      filters={[
        {
          area: 'categories',
          label: 'Categories',
          placeholder: 'All Game Categories',
          options: categoryOptions,
          value: category,
          onChange: setCategory,
        },
        {
          area: 'providers',
          label: 'Providers',
          placeholder: 'All Game Providers',
          options: providerOptions,
          value: provider,
          onChange: setProvider,
        },
      ]}
      /* `Games` goes to the lobby, not to `/games` — the reference's crumb
         points at its own all-games index and this site has no route for one
         yet, so it follows `Category`'s crumb rather than adding a 404. */
      breadcrumb={[{ label: 'Games', to: '/' }, { label: theme.label }]}
    />
  );
}
