import { useMemo, useState } from 'react';
import { GameCard } from './GameCard';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Icon } from '@/components/ui/Icon';
import { Pager } from '@/components/ui/Pager';
import { Select } from '@/components/ui/Select';
import { sortValue } from '@/data/adapters';
import { cn } from '@/lib/cn';

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
 * the list back exactly as the page handed it over.
 *
 * The other three sort on stats the platform **does not carry a column for**.
 * `rtp`, `volatility` and `hitRatio` are this site's own fields; Phase 0 seeds
 * them into the `parameters` JSONB for the placeholder catalogue, and anything
 * a real Slotegrator sync writes has none of them.
 *
 * That is why they go through `sortValue` rather than reading the field. A
 * bare `b.rtp - a.rtp` over a game with no RTP is `NaN`, and a comparator that
 * returns `NaN` is not a valid comparator — `Array.prototype.sort` is free to
 * leave the array in ANY order, so one unrated game can scramble a whole page
 * rather than merely misplacing itself. `byStat` gives the unrated games a
 * defined position instead: last, whichever way the list is sorted, because
 * "we do not know this game's RTP" is never a reason to rank it first.
 */
const byStat = (field) => (a, b) => {
  const left = sortValue(a, field);
  const right = sortValue(b, field);

  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return right - left;
};

const COMPARE = {
  popular: null,
  name: (a, b) => a.title.localeCompare(b.title),
  volatility: byStat('volatility'),
  hitRatio: byStat('hitRatio'),
  rtp: byStat('rtp'),
};

/**
 * Where each control sits in the filter bar's grid.
 *
 * Written out as whole class strings rather than built from the area name,
 * because Tailwind reads the source as text — an interpolated
 * `` `[grid-area:${area}]` `` generates no CSS at all and the bar silently
 * loses its layout.
 */
const AREA = {
  categories: '[grid-area:categories]',
  providers: '[grid-area:providers]',
  sort: '[grid-area:sort]',
};

/**
 * The chrome every game-listing page shares, in the reference's own order:
 * title and filter bar on one line, then the grid, then the breadcrumb —
 * which sits *below* the grid on the reference, not above it.
 *
 * ## The filter bar is one to three controls, placed by name
 *
 * `filters` is `[{ area, label, placeholder, options, value, onChange }]`,
 * where `area` is `categories` or `providers`. Each page passes the axes it is
 * not already fixed to: a category page filters by provider, a provider page
 * by category, and a **theme page by both** — which is the reason this is a
 * list rather than the single `filter` it used to be. A theme cuts across type
 * and studio, so neither axis is spoken for. Every set of options must include
 * its "All …" entry, since that is the only way back to the unfiltered list.
 *
 * Sorting is owned here, because every list sorts the same way, and it takes
 * the third area.
 *
 * The placement is the reference's own, and it is a `grid-template-areas`
 * rather than an order because the two layouts are not a reflow of each other:
 *
 * ```
 * phone            md and up
 * ┌────────┬─────┐  ┌──────────┬──────────┬──────┐
 * │providers│sort│  │categories│providers │ sort │
 * ├─────────┴────┤  └──────────┴──────────┴──────┘
 * │  categories  │
 * └──────────────┘
 * ```
 *
 * ## Below `md` the bar starts closed, behind the `Filters` button
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE REFERENCE SWITCHES ON THE USER AGENT, NOT ON THE VIEWPORT. Narrowing a
 * desktop browser will NOT show you its phone layout, and that is how this
 * came out wrong once already.
 *
 * Measured on `/themes/vip-prive`: with an iPhone UA it renders a 40x40
 * `aria-label="Filters"` button beside the heading and nothing else, at 390px
 * AND at 1024px. With a desktop UA it renders all three controls inline, at
 * 1440px AND at 390px. So it is `isMobile` on the server, not a media query.
 *
 * A previous pass resized a desktop browser, saw the controls at every width,
 * concluded the button did not exist and deleted it — leaving the `filters`
 * glyph in `ui/Icon.jsx` with no caller and its comment ("read off ... in a
 * phone context, which is the only state that renders it") pointing at
 * nothing. It does exist; that test could not reach it.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * This app is a client-rendered SPA, so it does the same thing by width
 * instead: closed below `md`, always open from `md`. Sniffing the UA here
 * would be worse and not more faithful — it would keep the phone layout on a
 * rotated tablet and drop it in a desktop browser's device mode, and it cannot
 * respond to a resize at all. A mobile UA is narrow in practice, so the
 * breakpoint reproduces what a phone actually sees.
 *
 * The controls themselves do not change: opening the bar reveals the same
 * two-row arrangement above, which is exactly what the reference's button
 * expands into.
 *
 * The grid is the reference's: auto-fitting tracks with a floor that steps
 * 6.5rem → 7.75rem → 8.75rem, so the row count follows the viewport instead
 * of being pinned to a breakpoint.
 */
export function GameList({ title, filters, games, breadcrumb, empty, pagination }) {
  const [sort, setSort] = useState('popular');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const hasFilters = Boolean(filters?.length);

  // With no filter bar there is no `Sort by`, so the list stays in the order
  // it arrived — which for a play history is the only order that is true, and
  // for a curated theme is the order the operator arranged.
  const sorted = useMemo(() => {
    const compare = hasFilters ? COMPARE[sort] : null;
    return compare ? [...games].sort(compare) : games;
  }, [hasFilters, games, sort]);

  return (
    <div className="flex flex-col gap-6">
      <div className="relative grid gap-4 md:mb-2.5 lg:grid-flow-col lg:justify-between">
        {/* The heading is a grid child in its own right, bottom-aligned so it
            sits on the baseline of the controls beside it from `lg` up. No
            padding: the reference's h1 starts exactly at the content gutter,
            16px on a phone and 32px from `md`, and the `p-1` this used to
            carry pushed it one pixel-and-a-bit further in at every width.

            DM Sans at 24/32 weight 400 — `font-primary` and `tracking-normal`
            undo the base `h1` rule, which sets the display face and -0.01em.
            The reference reads back `24px/32px`, weight `400`, `"DM Sans"` on
            every list page. */}
        {/*
          `p-1` below `md` only.

          Same trap as the filter button above: with a desktop UA the
          reference's h1 sits exactly on the content gutter at every width, and
          a previous pass deleted the padding on that evidence. With a phone UA
          it sits at 20px against a 16px grid and the grid starts 8px lower —
          which is 4px on all four sides of this block, and nothing else. From
          `md` there is no inset, and `md:p-0` is what keeps the desktop
          heading and grid on the reference's own baselines to the pixel.
        */}
        <div className="grid gap-1 p-1 md:p-0">
          {/* The heading and, below `md`, the button that opens the bar — the
              reference sets the two on one line with the button flush to the
              content gutter. `justify-between` rather than `ms-auto` on the
              button so the row is laid out the same whether or not the page
              has filters at all. */}
          <div className="flex items-center justify-between gap-4">
            <h1 className="z-2 self-end font-primary text-2xl leading-8 font-normal tracking-normal text-bulma">
              {title}
            </h1>

            {hasFilters && (
              <button
                type="button"
                /* The reference's own label. It is the accessible name of a
                   button whose only content is a glyph, so it is not optional
                   decoration — without it the control announces as "button". */
                aria-label="Filters"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((open) => !open)}
                className="grid size-10 shrink-0 place-items-center rounded-i-xs bg-gohan text-bulma transition-colors hover:bg-beerus md:hidden"
              >
                {/* 32 in a 40 box, which is the reference's own ratio — the
                    glyph is drawn on a 32 grid, so this renders it 1:1. */}
                <Icon name="filters" size={32} />
              </button>
            )}
          </div>
        </div>

        {/* The controls, or nothing at all. `/games/recent` is the page with
            no `filters` — the reference gives it a bare heading, because a
            play history has no axis to narrow by and its order (most recent
            first) is the only one that means anything. A lone `Sort by` next
            to nothing would be chrome that page does not have.

            `grid-template-areas` rather than source order, so one markup
            serves both arrangements — see the diagram above. A page that
            passes only `providers` leaves the `categories` row of the phone
            layout empty, and an empty grid row is zero-height, so the bar
            collapses to one line on its own. */}
        {hasFilters && (
          <div
            className={cn(
              'grid-cols-[1fr_1fr] gap-1 md:grid-flow-col md:grid-cols-[repeat(2,11.25rem)]',
              '[grid-template-areas:"providers_sort"_"categories_categories"]',
              'md:[grid-template-areas:"categories_providers_sort"]',
              /* `md:grid` unconditionally, so the closed state below `md`
                 cannot leak upward into a breakpoint that has no button to
                 reopen it. */
              filtersOpen ? 'grid' : 'hidden',
              'md:grid',
            )}
          >
            {filters.map((entry) => (
              <div key={entry.area} className={cn('relative w-full', AREA[entry.area])}>
                <Select
                  label={entry.label}
                  placeholder={entry.placeholder}
                  options={entry.options}
                  value={entry.value}
                  onChange={entry.onChange}
                />
              </div>
            ))}

            <div className={cn('relative w-full', AREA.sort)}>
              <Select
                variant="outline"
                label="Sort by"
                options={SORTS}
                value={sort}
                onChange={setSort}
              />
            </div>
          </div>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="py-16 text-center text-sm text-trunks">
          {empty ?? 'No games match this filter yet.'}
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

      {/*
        The row between the grid and the trail. On the reference this is the
        pagination slot — `<div class="mt-8">` on a list that fits in one page,
        the pager itself on a list that does not — and then the breadcrumb as
        the next child of the same `gap-6` column. Either way that is
        24 + 32 + 24 = 80px of air under the last row of tiles, where the
        trail's own `mt-8` alone gives 56.

        So the slot carries the 32 whether or not it has a pager in it, and
        `mt-0` takes the trail's margin off — rather than an `mt-14` on the
        trail that would be the right number for the wrong reason and would
        drift the moment the column's gap changes.
      */}
      <div className="mt-8">
        {pagination && (
          <Pager
            page={pagination.page}
            totalPages={pagination.totalPages}
            onChange={pagination.onChange}
            label={`${title} pages`}
          />
        )}
      </div>

      <Breadcrumb items={breadcrumb} className="mt-0" />
    </div>
  );
}
