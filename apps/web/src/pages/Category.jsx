import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { GameCard } from '@/components/sections/GameCard';
import { Chip } from '@/components/ui/Chip';
import { CATEGORIES, GAMES, PROVIDERS } from '@/data/catalog';

const ALL = 'all';

export function Category() {
  const { slug } = useParams();
  const [provider, setProvider] = useState(ALL);

  const category = CATEGORIES.find((c) => c.slug === slug);

  const games = useMemo(() => {
    const inCategory = slug ? GAMES.filter((g) => g.category === slug) : GAMES;
    return provider === ALL
      ? inCategory
      : inCategory.filter((g) => g.provider === provider);
  }, [slug, provider]);

  // Only offer filters for studios that actually appear in this category.
  const availableProviders = useMemo(() => {
    const inCategory = slug ? GAMES.filter((g) => g.category === slug) : GAMES;
    const names = new Set(inCategory.map((g) => g.provider));
    return PROVIDERS.filter((p) => names.has(p.name));
  }, [slug]);

  return (
    <div className="py-6">
      <h1 className="font-secondary text-xl font-light leading-8 text-bulma md:text-2xl">
        {category?.label ?? 'All games'}
      </h1>
      <p className="mt-1 text-sm text-trunks">
        {games.length} {games.length === 1 ? 'game' : 'games'}
      </p>

      {availableProviders.length > 1 && (
        <div className="rail gap-2 py-4">
          <Chip active={provider === ALL} onClick={() => setProvider(ALL)}>
            All providers
          </Chip>
          {availableProviders.map((p) => (
            <Chip
              key={p.id}
              active={provider === p.name}
              onClick={() => setProvider(p.name)}
            >
              {p.name}
            </Chip>
          ))}
        </div>
      )}

      {games.length === 0 ? (
        <p className="py-16 text-center text-sm text-trunks">
          No games match this filter yet.
        </p>
      ) : (
        <ul className="mt-2 grid grid-cols-3 gap-2 md:grid-cols-5 md:gap-3 xl:grid-cols-7">
          {games.map((game) => (
            <li key={game.id}>
              <GameCard game={game} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
