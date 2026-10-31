/**
 * The one place that knows how the catalogue relates to our category slugs.
 *
 * It used to be the identity, because Phase 0 seeded the catalogue with our
 * own slugs as `type`. The real sync writes the provider's own words (`Slot
 * Game`, `CasinoLive`, ...), so every category page sent a `?type=` nothing
 * matched. Both directions are written down HERE, once: a row's word -> our
 * slug (`categoryFromType`), and our slug -> the backend filter that lists it
 * (`categoryFilter`).
 *
 * @see data/types.js for the `GameCategory` union these slugs belong to.
 */

/** Our ten, in the order the nav and the category pages present them. */
export const CATEGORY_SLUGS = Object.freeze([
  'originals',
  'live-casino',
  'baccarat',
  'blackjack',
  'roulette',
  'video-slots',
  'table-games',
  'crash',
  'game-shows',
  'jackpots',
]);

/**
 * Upstream word -> our slug.
 *
 * Fed two words per row by `toGame`: the backend's normalised tag first
 * (`tags[0]` — `slots`, `live`, `table`, `crash`, written by the import), then
 * the provider's own `type` (`Slot Game`, `CasinoLive`, ...), which five
 * providers spell five ways. The identity rows stay for the seeded in-house
 * rows that carry our own slug as their type.
 *
 * Keys are compared lowercased and with `_`/spaces folded to `-`, so
 * `Live_Casino`, `live casino` and `live-casino` all land on the same row
 * without three entries.
 */
const TYPE_TO_SLUG = Object.freeze({
  originals: 'originals',
  'live-casino': 'live-casino',
  baccarat: 'baccarat',
  blackjack: 'blackjack',
  roulette: 'roulette',
  'video-slots': 'video-slots',
  'table-games': 'table-games',
  crash: 'crash',
  'game-shows': 'game-shows',
  jackpots: 'jackpots',
  // The backend's normalised tags (`#filterClause` in games.service.js).
  slots: 'video-slots',
  live: 'live-casino',
  table: 'table-games',
  // Provider types seen in the catalogue (`GET /casino/games/stats`).
  'slot-game': 'video-slots',
  slot: 'video-slots',
  'video-slot': 'video-slots',
  casinolive: 'live-casino',
  'table-game': 'table-games',
  tablegame: 'table-games',
  casinotable: 'table-games',
  'crash-game': 'crash',
});

/**
 * Our slug -> the `GET /casino/games` filter that lists its games.
 *
 * `?category=` is the backend's own lobby filter — the same keys its seeded
 * lobby categories fall back to (`CATEGORY_AUTO_LISTS`): a normalised tag
 * (`slots`, `live`, `table`, `crash`), or a name match it keeps itself
 * (`roulette`, `blackjack`, `baccarat`, `game-shows`). `?type=` cannot do
 * this: it is an exact match on the provider's own word, and `?type=slots`
 * finds 310 of the ~1,360 slots.
 *
 * Two have no backend category:
 * - `originals` — the in-house games are `js_games` rows, not catalogue rows,
 *   so the filter is sent as is and honestly answers nothing;
 * - `jackpots` — shortcut: a name match on "jackpot", the way the backend
 *   finds roulette; upgrade when the catalogue flags jackpot games.
 */
const SLUG_FILTER = Object.freeze({
  originals: { category: 'originals' },
  'live-casino': { category: 'live' },
  baccarat: { category: 'baccarat' },
  blackjack: { category: 'blackjack' },
  roulette: { category: 'roulette' },
  'video-slots': { category: 'slots' },
  'table-games': { category: 'table' },
  crash: { category: 'crash' },
  'game-shows': { category: 'game-shows' },
  poker: { category: 'poker' },
  jackpots: { search: 'jackpot' },
});

/**
 * The slices a category PAGE offers in its Categories dropdown.
 *
 * `live-casino` is the sidebar's **All Live Casino Games**, so the live
 * baccarat, blackjack and roulette tables and the game shows are all in it —
 * the backend's `live` covers them by tag — and the page narrows to each.
 */
const SUBCATEGORIES = Object.freeze({
  'live-casino': Object.freeze(['baccarat', 'blackjack', 'roulette', 'game-shows']),
});

/** Fold case and separators so `Live_Casino` and `live casino` compare equal. */
const normalise = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

/**
 * Map an upstream `type` onto one of our ten slugs.
 *
 * Returns `null` for a type we do not recognise rather than guessing. An
 * unmapped game is one that should not appear under a category it does not
 * belong to — a wrong category is worse than an absent one, because the player
 * cannot tell it is wrong.
 *
 * @param {string} type `gisgamesnew.type`
 * @returns {string | null}
 */
export function categoryFromType(type) {
  return TYPE_TO_SLUG[normalise(type)] ?? null;
}

/** Whether a slug is one of ours. Guards the `/categories/:slug` route. */
export function isCategorySlug(slug) {
  return CATEGORY_SLUGS.includes(normalise(slug));
}

/**
 * The `GET /casino/games` filter for one of our slugs (see `SLUG_FILTER`).
 *
 * Falls back to `?category=<slug>` for anything not in the table, so an
 * unknown slug asks the backend rather than listing the whole catalogue.
 *
 * @param {string} slug
 * @returns {{category?: string, search?: string}}
 */
export function categoryFilter(slug) {
  const key = normalise(slug);
  return SLUG_FILTER[key] ?? { category: key };
}

/** The sub-categories a category page can narrow to; empty for most. */
export function subcategoriesOf(slug) {
  return SUBCATEGORIES[normalise(slug)] ?? [];
}
