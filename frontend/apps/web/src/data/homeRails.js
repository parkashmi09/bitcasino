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
 * - The live, slots and crash rails read their category, not the curated
 *   collection of the same name: those collections are empty until an
 *   operator fills them, and the backend's own lobby falls back to the same
 *   `?category=` list (`CATEGORY_AUTO_LISTS`) while they are.
 * - Two rails have no curated equivalent and read their category too.
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
    href: '/categories/live-casino',
    source: { kind: 'category', slug: 'live-casino' },
  },
  {
    title: 'Best Slot games',
    href: '/categories/video-slots',
    source: { kind: 'category', slug: 'video-slots' },
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
    href: '/categories/crash',
    source: { kind: 'category', slug: 'crash' },
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
