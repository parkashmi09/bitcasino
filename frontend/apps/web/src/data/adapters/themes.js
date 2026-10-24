/**
 * The lists this site offers at `/themes/:slug`.
 *
 * ## A theme is not a category and not a collection
 *
 * The reference runs three list spaces beside each other and they are
 * different things:
 *
 * | Route | What it is |
 * | --- | --- |
 * | `/categories/:slug` | every game of a type — `?type=` on the browse route |
 * | `/games/:slug` | a row an operator curated, or one this site cuts by badge |
 * | `/themes/:slug` | a hand-picked set that cuts *across* type and studio |
 *
 * `Live Exclusives` is the clearest case: seven Evolution tables that are
 * baccarat, blackjack and roulette all at once, picked because the operator
 * has them exclusively rather than because they share a `type`. No query
 * against `GET /casino/games` can express that — see `adapters/collections.js`
 * for the same argument about `new` and `exclusives`, and for the two ways out
 * (curate them upstream, or add a `label` filter).
 *
 * So a theme names its members, in the order it wants them shown, and
 * `queries/themes.js` picks them out of a page of the catalogue. Membership is
 * curation, and writing it down is the honest form of that — the alternative
 * was a filter over provider and badge that happens to select these seven
 * today and silently gains an eighth the moment the catalogue grows.
 *
 * ## Order is part of the curation
 *
 * `games` is ordered, and `themeCut` preserves that order rather than the
 * catalogue's. The browse route answers alphabetically; the reference's theme
 * page does not, because an operator arranged it. `GameList`'s `Popularity`
 * sort is "leave the list as it arrived", so it lands on this order — which is
 * what makes that option mean something on a curated page.
 */

/**
 * Theme slug -> `{label, games}` or `{label, filter}`.
 *
 * All four of the sidebar's theme rows have content. `games` is catalogue
 * slugs in the order the page shows them; `scripts/verify-api-contract.mjs`
 * will say if one of them names nothing.
 *
 * A game may belong to more than one theme — `exclusive-salon-prive-baccarat`
 * is in two of these, exactly as it is on the reference. Membership is a list
 * of names, so that costs nothing and needs no second catalogue row.
 *
 * ## `filter` is the other kind of theme, and Bonus Buy-in is why
 *
 * Everything above argues that membership is curation and should be written
 * down. That holds for a page of seven tables, or twenty, or five. It does not
 * hold for `/themes/bonus-buy-in`, which on the reference is **seventy-four
 * pages** — around two and a half thousand titles. Nobody curated that. It is
 * a filter over a property of the game: whether the slot sells its bonus round
 * outright.
 *
 * So that theme carries a predicate instead of a list, and `bonusBuy` is a
 * field on the catalogue row (`data/catalog.js`). Writing out two thousand
 * slugs would not be more honest — it would be a snapshot of a query, stale
 * the moment the catalogue grows, and it would hide the fact that the page has
 * a rule behind it.
 *
 * The test for which kind a theme is: could a person have picked these by
 * hand, and would a new game qualifying be a decision or a consequence? Live
 * Exclusives is a decision. Bonus Buy-in is a consequence.
 */
export const THEMES = Object.freeze({
  'live-exclusives': {
    label: 'Live Exclusives',
    games: Object.freeze([
      'exclusive-speed-baccarat-1',
      'exclusive-speed-roulette',
      'exclusive-salon-prive-baccarat',
      'exclusive-blackjack-2',
      'exclusive-blackjack',
      'exclusive-blackjack3',
      'exclusive-squeeze-baccarat',
    ]),
  },

  /**
   * The high-limit room: twenty Evolution Salon Prive tables, in the
   * reference's own order. `VIP_PRIVE` in `data/catalog.js` carries nineteen
   * of them; the twentieth is the baccarat table above, which is on both of
   * its theme pages.
   *
   * The label is `VIP Prive` without the accent, which is how the reference
   * writes it in the sidebar, in the `h1` and in the breadcrumb — even though
   * it accents two of the individual table names.
   */
  'vip-prive': {
    label: 'VIP Prive',
    games: Object.freeze([
      'exclusive-salon-prive-baccarat',
      'salon-prive-blackjack-a',
      'salon-prive-lobby',
      'salon-prive-blackjack-f',
      'salon-prive-baccarat-d',
      'salon-prive-blackjack-g',
      'salon-prive-blackjack-h',
      'salon-prive-baccarat',
      'salon-prive-blackjack-i',
      'salon-prive-auto-roulette-b',
      'salon-prive-blackjack-j',
      'salon-prive-blackjack-k',
      'salon-prive-blackjack-l',
      'salon-prive-blackjack-m',
      'salon-prive-blackjack-c',
      'korean-salon-prive-baccarat',
      'salon-prive-blackjack-d',
      'salon-prive-roulette',
      'salon-prive-blackjack-e',
      'salon-prive-baccarat-c',
    ]),
  },

  /**
   * The operator's own-brand slots — five of them, and five on the reference.
   *
   * `BITCASINO_EXCLUSIVES` in `data/catalog.js` carries the rows. The label
   * keeps the reference's own capitalisation (`Bitcasino`, not `BitCasino`),
   * which is what its `h1` reads even though the sidebar row beside it does
   * not.
   */
  'bitcasino-exclusives': {
    label: 'Bitcasino Exclusives',
    games: Object.freeze([
      'book-of-bitcasino',
      'bitcasino-sweets',
      'bitcasinobillion',
      'bitshark-megaways',
      'bitcasinostarburst',
    ]),
  },

  /**
   * Every slot that sells its bonus round. A rule, not a list — see the note
   * above, and `bonusBuy` in `data/catalog.js`.
   *
   * `Bonus Buy-in`, lower-case `i`: that is how the reference's `h1` spells
   * it. Its sidebar row says `Bonus Buy-in` too; ours said `Bonus Buy-In` and
   * now matches.
   */
  'bonus-buy-in': {
    label: 'Bonus Buy-in',
    filter: (game) => game.bonusBuy === true,
  },
});

/** Every theme slug this site serves. */
export const THEME_SLUGS = Object.freeze(Object.keys(THEMES));

/**
 * What `/themes/:slug` should do for a slug.
 *
 * Returns `{slug, label, games, cut}` or `null` for a theme this site does not
 * serve — the page turns that into "list not found" rather than an empty grid,
 * because a wrong URL and an empty curated list are different answers.
 *
 * @param {string} slug
 */
export function resolveTheme(slug) {
  const key = String(slug ?? '').trim().toLowerCase();
  const theme = THEMES[key];
  if (!theme) return null;

  /**
   * A named theme keeps its own order; a filtered one keeps the catalogue's.
   *
   * Which is right in both cases. The order of a curated list IS the curation
   * — an operator arranged those seven — so `themeCut` restores it. A rule has
   * no order of its own to restore, so the rows stay as the catalogue handed
   * them over, which is what `Popularity` means everywhere else in this app.
   */
  const cut = theme.filter
    ? (games) => games.filter(theme.filter)
    : themeCut(theme.games);

  return { slug: key, label: theme.label, games: theme.games, cut };
}

/**
 * A cut that keeps the named games, in the order they were named.
 *
 * Built as a lookup rather than an `indexOf` per game: the sample it runs over
 * is `CUT_SAMPLE` rows and the theme is seven, and `filter(includes)` over
 * both is the kind of quadratic that is invisible at this size and is not the
 * shape to leave behind.
 *
 * A named game the catalogue does not have is simply absent — the page shows
 * six tiles rather than six tiles and a hole. `verify-api-contract.mjs` is
 * where a missing member is meant to be caught.
 *
 * @param {readonly string[]} slugs
 * @returns {(games: import('../types').Game[]) => import('../types').Game[]}
 */
export function themeCut(slugs) {
  const rank = new Map(slugs.map((slug, i) => [slug, i]));

  return (games) =>
    games
      .filter((game) => rank.has(game.slug))
      .sort((a, b) => rank.get(a.slug) - rank.get(b.slug));
}
