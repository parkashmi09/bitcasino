/**
 * The one place that knows how `gisgamesnew.type` relates to our category
 * slugs.
 *
 * Today the two are identical, because Phase 0 seeded the catalogue from
 * `data/catalog.js` and wrote our own `category` into `type`. That is a
 * temporary coincidence, not a contract: the moment a real Slotegrator sync
 * runs, `type` becomes whatever the aggregator writes — `slots`, `livedealer`,
 * `virtual_sports` and so on — and every one of the seven category pages, the
 * seven nav entries and the sort control has to keep working.
 *
 * So the mapping is written down even while it is the identity, and it is
 * written down HERE, once. `docs/10-backend-integration.md` calls for exactly
 * this: a real sync should cost a change in one file rather than in seven
 * pages.
 *
 * @see data/types.js for the `GameCategory` union these slugs belong to.
 */

/** Our seven, in the order the nav and the category pages present them. */
export const CATEGORY_SLUGS = Object.freeze([
  'originals',
  'live-casino',
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
  'video-slots': 'video-slots',
  'table-games': 'table-games',
  crash: 'crash',
  'game-shows': 'game-shows',
  jackpots: 'jackpots',
});

/**
 * Our slug -> the `type` value to send as `?type=`.
 *
 * Derived from `TYPE_TO_SLUG` rather than written twice, so the two can never
 * drift apart. Where several upstream types map onto one of our slugs, the
 * FIRST one wins as the canonical query value — which is why a real sync that
 * folds `slots` and `videoslots` together will also want
 * `queryTypesFor()` below, not this.
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
 * Map an upstream `type` onto one of our seven slugs.
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
 * Every upstream type that maps onto one of our slugs.
 *
 * One entry today. It exists because `?type=` takes a single value, so a slug
 * backed by several upstream types needs either one request per type or a
 * client-side filter — and the call site can only make that choice if it can
 * see how many there are.
 *
 * @param {string} slug
 * @returns {string[]}
 */
export function queryTypesFor(slug) {
  const target = normalise(slug);
  const matches = Object.entries(TYPE_TO_SLUG)
    .filter(([, mapped]) => mapped === target)
    .map(([type]) => type);
  return matches.length ? matches : [target];
}
