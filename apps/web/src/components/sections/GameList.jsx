import { useMemo, useState } from 'react';
import { GameCard } from './GameCard';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Select } from '@/components/ui/Select';
import { VOLATILITY } from '@/data/catalog';

/**
 * The reference's five sort options, in its order and with its labels.
 * Verbatim from the page's own payload:
 * `[{popular, Popularity}, {name, A-Z}, {volatility, Volatility},
 *   {hitRatio, Hit Ratio}, {rtp, RTP}]`.
 */
const SORTS = [
  { value: 'popular', label: 'Popularity' },
  { value: 'name', label: 'A-Z' },
  { value: 'volatility', label: 'Volatility' },
  { value: 'hitRatio', label: 'Hit Ratio' },
  { value: 'rtp', label: 'RTP' },
];

/**
 * `popular` has no comparator on purpose: popularity *is* the catalogue's own
 * order — the house ranking the list already arrives in — so choosing it puts
 * the list back exactly as the page handed it over. The other four read the
 * seeded stat fields, all of them best-first.
 */
const COMPARE = {
  popular: null,
  name: (a, b) => a.title.localeCompare(b.title),
  volatility: (a, b) =>
    VOLATILITY.indexOf(b.volatility) - VOLATILITY.indexOf(a.volatility),
  hitRatio: (a, b) => b.hitRatio - a.hitRatio,
  rtp: (a, b) => b.rtp - a.rtp,
};

/**
 * The chrome every game-listing page shares, in the reference's own order:
 * title and filter bar on one line, then the grid, then the breadcrumb —
 * which sits *below* the grid on the reference, not above it.
 *
 * The two controls are always the same pair: one dropdown that narrows the
 * list by the axis the page is *not* already fixed to (a category page filters
 * by provider, a provider page by category) and one that sorts. `filter`
 * carries that first dropdown — `{ label, placeholder, options, value,
 * onChange }` — and its options must include the "All …" entry, since it is
 * the only way back to the unfiltered list. Sorting is owned here, because
 * every list sorts the same way.
 *
 * The grid is the reference's: auto-fitting tracks with a floor that steps
 * 6.5rem → 7.75rem → 8.75rem, so the row count follows the viewport instead
 * of being pinned to a breakpoint.
 */
export function GameList({ title, filter, games, breadcrumb }) {
  const [sort, setSort] = useState('popular');

  const sorted = useMemo(() => {
    const compare = COMPARE[sort];
    return compare ? [...games].sort(compare) : games;
  }, [games, sort]);

  return (
    <div className="flex flex-col gap-6 py-2">
      <div className="grid gap-4 md:mb-2.5 lg:grid-flow-col lg:justify-between">
        <h1 className="self-end font-secondary text-xl font-light leading-8 text-bulma md:text-2xl">
          {title}
        </h1>

        <div className="grid gap-1 md:grid-flow-col md:grid-cols-[repeat(2,11.25rem)]">
          <Select
            label={filter.label}
            placeholder={filter.placeholder}
            options={filter.options}
            value={filter.value}
            onChange={filter.onChange}
          />
          <Select
            variant="outline"
            label="Sort by"
            options={SORTS}
            value={sort}
            onChange={setSort}
          />
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="py-16 text-center text-sm text-trunks">
          No games match this filter yet.
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-2 gap-y-3 sm:gap-4 md:grid-cols-[repeat(auto-fill,minmax(7.75rem,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(8.75rem,1fr))]">
          {sorted.map((game) => (
            <li key={game.id}>
              <GameCard game={game} className="w-full" />
            </li>
          ))}
        </ul>
      )}

      <Breadcrumb items={breadcrumb} />
    </div>
  );
}
