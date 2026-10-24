/**
 * The home page's game rails, in the reference's order.
 *
 * Replaces `HOME_RAILS` in `data/catalog.js`, which built each rail by
 * filtering a static array. Each entry now names a **source** the platform can
 * actually serve, and `CatalogueRail` fetches it.
 *
 * ## Why the sources are mixed
 *
 * `docs/10-backend-integration.md` says "collections per rail; `?type=` for
 * the rest", and that is what this is:
 *
 * - Three rails match a row the platform curates, so they read it. An operator
 *   editing "Live casino" in the admin screen changes this rail, which is the
 *   entire point of a curated collection and does not happen if the rail runs
 *   its own `?type=` query.
 * - Two rails have no curated equivalent and fall back to their category.
 * - Two are badge cuts the browse route cannot express at all — see
 *   `data/adapters/collections.js` for why, and for the two backend changes
 *   that would fix it.
 *
 * The old file padded short rails with filler from other categories so every
 * row scrolled. That is gone: a rail with four games in it now shows four.
 * Padding a curated row with games an operator did not curate misrepresents
 * the row, and on a real catalogue the rails are long anyway.
 */

/** @typedef {{kind: 'category' | 'collection' | 'cut', slug: string}} RailSource */

/**
 * @type {Array<{
 *   title: string,
 *   href: string,
 *   source: RailSource,
 *   featured?: boolean,
 * }>}
 */
export const HOME_RAILS = Object.freeze([
  {
    title: 'BitCasino Originals',
    href: '/categories/originals',
    // No curated row for the in-house games; the type is the list.
    source: { kind: 'category', slug: 'originals' },
    // The 1.3:1 crop, first rail only.
    featured: true,
  },
  {
    title: 'Best Live Casino games',
    href: '/games/live-casino',
    source: { kind: 'collection', slug: 'live-casino' },
  },
  {
    title: 'Best Slot games',
    href: '/games/popular-slots',
    source: { kind: 'collection', slug: 'popular-slots' },
  },
  {
    title: 'New Releases',
    href: '/games/new',
    source: { kind: 'cut', slug: 'new' },
  },
  {
    title: 'BitCasino Exclusives',
    href: '/games/exclusives',
    source: { kind: 'cut', slug: 'exclusives' },
  },
  {
    title: 'Crash and Instant Win',
    href: '/games/crash',
    source: { kind: 'collection', slug: 'crash' },
  },
  {
    title: 'Best table games',
    href: '/categories/table-games',
    source: { kind: 'category', slug: 'table-games' },
  },
]);

/**
 * The Themes strip sits between "Exclusives" and "Crash" on the reference
 * page. `Home` splits `HOME_RAILS` here to slot it in.
 */
export const THEME_RAIL_INDEX = 5;
