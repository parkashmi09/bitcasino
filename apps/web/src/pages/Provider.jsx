import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GameList } from '@/components/sections/GameList';
import { CATEGORIES, GAMES, PROVIDERS } from '@/data/catalog';

const ALL = '';

/**
 * One studio's catalogue, at `/providers/:slug`.
 *
 * The mirror of `Category`: this page is fixed to a provider, so the dropdown
 * it offers is the category one — "All Game Categories" — exactly as the
 * reference's provider pages do it. Both pages otherwise share `GameList`,
 * because the reference gives them identical chrome.
 */
export function Provider() {
  const { slug } = useParams();
  const [category, setCategory] = useState(ALL);

  const provider = PROVIDERS.find((p) => p.slug === slug);

  const inList = useMemo(
    () => (provider ? GAMES.filter((g) => g.provider === provider.name) : []),
    [provider],
  );

  const games = useMemo(
    () => (category === ALL ? inList : inList.filter((g) => g.category === category)),
    [inList, category],
  );

  const categoryOptions = useMemo(() => {
    const present = new Set(inList.map((g) => g.category));
    return [
      { value: ALL, label: 'All Game Categories' },
      ...CATEGORIES.filter((c) => present.has(c.slug)).map((c) => ({
        value: c.slug,
        label: c.label,
      })),
    ];
  }, [inList]);

  if (!provider) {
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

  return (
    <GameList
      title={provider.name}
      games={games}
      filter={{
        label: 'Categories',
        placeholder: 'All Game Categories',
        options: categoryOptions,
        value: category,
        onChange: setCategory,
      }}
      breadcrumb={[{ label: 'Providers', to: '/providers' }, { label: provider.name }]}
    />
  );
}
