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
 * - New Releases reads the admin's `new` Lobby category.
 *
 * The old file padded short rails with filler from other categories so every
 * row scrolled. That is gone: a rail with four games in it now shows four.
 * Padding a curated row with games an operator did not curate misrepresents
 * the row, and on a real catalogue the rails are long anyway.
 */

/** @typedef {{kind: 'category' | 'collection' | 'lobby', slug: string, auto?: string | null}} RailSource */

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
    title: 'Originals',
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
    source: { kind: 'lobby', slug: 'new', auto: null },
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
 * The Themes strip sits just before "Crash" on the reference page. `Home`
 * splits `HOME_RAILS` here to slot it in.
 */
export const THEME_RAIL_INDEX = 5;

/**
 * Lobby category (site admin) -> the site's category page, whose filter is the automatic list the
 * backend's `CATEGORY_AUTO_LISTS` uses for it. `hot` and `new` have none: they show only what the
 * admin picks, and a rail with no games is not drawn.
 */
export const LOBBY_AUTO = Object.freeze({
  slots: 'video-slots',
  live: 'live-casino',
  'game-shows': 'game-shows',
  'table-game': 'table-games',
  blackjack: 'blackjack',
  roulette: 'roulette',
  baccarat: 'baccarat',
  poker: 'poker',
  'crash-games': 'crash',
});

/** One lobby category row (`{slug, name}`) -> a home rail. */
export function lobbyRail(category) {
  const auto = LOBBY_AUTO[category.slug] ?? null;
  return {
    title: category.name,
    href: auto ? `/categories/${auto}` : undefined,
    source: { kind: 'lobby', slug: category.slug, auto },
  };
}
