/**
 * The one place that knows how `gisgamesnew.type` relates to our category
 * slugs.
 *
 * Today the two are identical, because Phase 0 seeded the catalogue from
 * `data/catalog.js` and wrote our own `category` into `type`. That is a
 * temporary coincidence, not a contract: the moment a real Slotegrator sync
 * runs, `type` becomes whatever the aggregator writes — `slots`, `livedealer`,
 * `virtual_sports` and so on — and every one of the ten category pages, the
 * nav entries and the sort control has to keep working.
 *
 * So the mapping is written down even while it is the identity, and it is
 * written down HERE, once. `docs/10-backend-integration.md` calls for exactly
 * this: a real sync should cost a change in one file rather than in ten
 * pages.
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
 * Upstream `type` -> our slug.
 *
 * Keys are compared lowercased and with `_`/spaces folded to `-`, so
 * `Live_Casino`, `live casino` and `live-casino` all land on the same row
 * without three entries. Add aliases here as a real sync reveals them; the
 * identity rows are listed explicitly rather than inferred, so that deleting
 * one is a visible decision.
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
});

/**
 * Slugs whose PAGE covers more types than the one that maps back to them.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * A game has exactly one category. A category page may cover several.
 *
 * These are not the same question, and collapsing them is what makes a table
 * disappear. `categoryFromType` answers the first — it decides what a tile
 * says it is and which `/play/:category/:slug` URL it gets, so it has to pick
 * one. This table answers the second.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * `live-casino` is the case that forces it. The sidebar calls that row **All
 * Live Casino Games**, and on the reference it means exactly that: reading its
 * own `/categories/live-casino` back gives tiles typed `live-baccarat`,
 * `live-blackjack`, `live-roulette`, `live-game-shows`, `live-dice` and
 * `live-dealer` — the sub-category pages are slices of it, not siblings beside
 * it. So a Salon Prive table is a `blackjack` game AND a live casino game, and
 * moving it into the new category must not take it out of the old page.
 *
 * Anything not listed here covers its own type and nothing else, which is why
 * this is a short exception table rather than a second copy of the ten.
 */
const SLUG_EXTRA_TYPES = Object.freeze({
  'live-casino': ['baccarat', 'blackjack', 'roulette'],
});

/**
 * Our slug -> the single canonical `type` value for it.
 *
 * Derived from `TYPE_TO_SLUG` rather than written twice, so the two can never
 * drift apart. Where several upstream types map onto one of our slugs, the
 * FIRST one wins.
 *
 * A category PAGE does not use this — it uses `queryTypesFor` below, which
 * also picks up the sub-categories a page covers. This is for the places that
 * genuinely need one string.
 */
const SLUG_TO_TYPE = Object.freeze(
  Object.fromEntries(
    CATEGORY_SLUGS.map((slug) => [
      slug,
      Object.entries(TYPE_TO_SLUG).find(([, mapped]) => mapped === slug)?.[0] ?? slug,
    ]),
  ),
);

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

/**
 * The `?type=` value for one of our slugs.
 *
 * Falls back to the slug itself for anything not in the table, which is what
 * makes a newly added category work before its alias is known.
 *
 * @param {string} slug
 * @returns {string}
 */
export function typeForCategory(slug) {
  return SLUG_TO_TYPE[normalise(slug)] ?? String(slug ?? '');
}

/** Whether a slug is one of ours. Guards the `/categories/:slug` route. */
export function isCategorySlug(slug) {
  return CATEGORY_SLUGS.includes(normalise(slug));
}

/**
 * Every upstream type a category PAGE should show.
 *
 * The types that map back to the slug, plus any `SLUG_EXTRA_TYPES` entry — so
 * `live-casino` answers its own type and the three sub-categories carved out
 * of it, and everything else answers one type.
 *
 * `queryFor` in `queries/params.js` joins these with a comma, which
 * `GET /casino/games` reads as a set. Duplicates are dropped here rather than
 * relied on being absent, because the two sources can overlap the moment an
 * alias is added above.
 *
 * @param {string} slug
 * @returns {string[]}
 */
export function queryTypesFor(slug) {
  const target = normalise(slug);
  const mapped = Object.entries(TYPE_TO_SLUG)
    .filter(([, to]) => to === target)
    .map(([type]) => type);
  const base = mapped.length ? mapped : [target];
  return [...new Set([...base, ...(SLUG_EXTRA_TYPES[target] ?? [])])];
}
