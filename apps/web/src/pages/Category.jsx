import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { GameList } from '@/components/sections/GameList';
import { CATEGORIES, COLLECTIONS, GAMES, PROVIDERS } from '@/data/catalog';

const ALL = '';

/**
 * Game listing for a category (`/categories/:slug`) or a curated collection
 * (`/games/:slug`).
 *
 * The page is already fixed to one category, so — as on the reference — the
 * dropdown it offers is the *other* axis: provider. Only studios with a game
 * in this list are listed, so the filter can never return nothing.
 */
export function Category() {
  const { slug } = useParams();
  const [provider, setProvider] = useState(ALL);

  const category = CATEGORIES.find((c) => c.slug === slug);
  const collection = COLLECTIONS[slug];

  const inList = useMemo(() => {
    if (collection) return collection.select(GAMES);
    return slug ? GAMES.filter((g) => g.category === slug) : GAMES;
  }, [collection, slug]);

  const games = useMemo(
    () => (provider === ALL ? inList : inList.filter((g) => g.provider === provider)),
    [inList, provider],
  );

  const providerOptions = useMemo(() => {
    const present = new Set(inList.map((g) => g.provider));
    return [
      { value: ALL, label: 'All Game Providers' },
      ...PROVIDERS.filter((p) => present.has(p.name)).map((p) => ({
        value: p.name,
        label: p.name,
      })),
    ];
  }, [inList]);

  const title = category?.label ?? collection?.label ?? 'All games';

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
