/**
 * The seven categories this site presents, with their copy and icons.
 *
 * Moved out of `data/catalog.js` because it is not catalogue data: the
 * platform has no label or icon for a game type, only the `type` string
 * itself. The label is editorial ("Crash & Instant", not `crash`) and the icon
 * is a name from `components/ui/Icon.jsx`. Neither survives a round trip
 * through the API, so neither belongs in a module that is being retired as the
 * pages move onto it.
 *
 * `slug` is the same seven `data/adapters/categories.js` maps
 * `gisgamesnew.type` onto, and the order here is the order the nav and the
 * category pages present them in. The two lists are asserted equal by
 * `data/adapters/adapters.test.js` — a category added here without a mapping
 * would render a nav entry whose page can never have anything in it.
 *
 * @type {import('./types').Category[]}
 */
export const CATEGORIES = Object.freeze([
  { slug: 'originals', label: 'Originals', icon: 'sparkle' },
  { slug: 'live-casino', label: 'Live Casino', icon: 'live' },
  { slug: 'video-slots', label: 'Slots', icon: 'grid' },
  { slug: 'table-games', label: 'Table Games', icon: 'cards' },
  { slug: 'crash', label: 'Crash & Instant', icon: 'bolt' },
  { slug: 'game-shows', label: 'Game Shows', icon: 'trophy' },
  { slug: 'jackpots', label: 'Jackpots', icon: 'star' },
]);

/** The editorial label for a category slug, or the slug itself. */
export function categoryLabel(slug) {
  return CATEGORIES.find((category) => category.slug === slug)?.label ?? slug;
}
