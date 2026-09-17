import { categoryFromType } from './categories.js';

/**
 * `gisgamesnew` rows -> the `Game` shape every section component already
 * renders.
 *
 * This is the whole point of the adapter layer: `GameCard`, `GameRail`,
 * `GameList`, `ThemeRail` and `SearchDialog` were written against
 * `data/catalog.js` and must not learn that a backend exists. They keep
 * reading `game.title`, `game.thumb` and `game.badge`; this file is the only
 * thing that knows those are `name`, `image` and `label` upstream.
 *
 * ## The catalogue answers three different shapes
 *
 * The same game arrives with different fields depending on the route:
 *
 * | Route | `parameters` | `images` | `label` |
 * | --- | --- | --- | --- |
 * | `GET /casino/games` | yes | yes | yes |
 * | `GET /casino/games/collections/:c` | yes | yes | yes |
 * | `GET /casino/games/search` | **no** | **no** | **no** |
 *
 * So every field outside the core five is optional, and `toGame` must produce
 * a renderable object from the leanest of the three. A search result with no
 * `images` still needs a `thumbWide`, because the featured rail reads it.
 *
 * ## Fields the platform does not carry
 *
 * `rtp`, `volatility` and `hitRatio` are the web app's own — there is no
 * column for them. Phase 0 seeds them into the `parameters` JSONB, so they are
 * present for our placeholder catalogue and will be **absent** for anything a
 * real Slotegrator sync writes. `GameList`'s sort control offers all three, so
 * it has to degrade rather than sort on `undefined`; `sortValue` below is how
 * it asks whether a value is there.
 *
 * @see data/types.js for the `Game` typedef this produces.
 */

/** The four the reference site renders as a corner flag. Anything else drops. */
const BADGES = Object.freeze(['new', 'hot', 'exclusive', 'jackpot']);

/** Ranked low -> high, matching `VOLATILITY` in `data/catalog.js`. */
const VOLATILITY = Object.freeze(['low', 'medium', 'high']);

/** A finite number, or undefined. Never `NaN`, never a string that looks numeric. */
function num(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Category slug -> the art file that actually exists for it.
 *
 * Written out because the two do NOT agree: `crash` is served from
 * `crash-instant-win.png`, `live-casino` from `live-games.png`, and
 * `video-slots` is an `.svg` where the rest are `.png`. Deriving the path from
 * the slug produces three 404s out of seven — a broken-image glyph in place of
 * the fallback that was supposed to prevent one.
 *
 * `scripts/verify-api-contract.mjs` asserts every value here exists on disk,
 * so a renamed asset fails there rather than in a rail.
 */
const CATEGORY_ART = Object.freeze({
  originals: '/images/categories/originals.png',
  'live-casino': '/images/categories/live-games.png',
  'video-slots': '/images/categories/video-slots.svg',
  'table-games': '/images/categories/table-games.png',
  crash: '/images/categories/crash-instant-win.png',
  'game-shows': '/images/categories/game-shows.png',
  jackpots: '/images/categories/jackpots.png',
});

/**
 * Placeholder art for a game whose `image` is empty.
 *
 * The catalogue's `image` column is nullable and a real sync leaves it null
 * for titles whose art has not been fetched yet. An empty `src` renders as a
 * broken-image glyph in every browser, which looks like a bug in our grid
 * rather than a gap in the catalogue — so a category-shaped placeholder stands
 * in. A game whose type we do not recognise gets the Originals tile, which is
 * the one category every deployment has.
 */
const fallbackArt = (category) => CATEGORY_ART[category] ?? CATEGORY_ART.originals;

export { CATEGORY_ART };

/**
 * One catalogue row -> one `Game`.
 *
 * Returns `null` for a row with no `uuid`, which is the one field everything
 * downstream keys on — React lists, the query cache and the `/play` route all
 * need it. Callers should use `toGames`, which drops the nulls.
 *
 * @param {object} row A row from any of the three catalogue routes.
 * @returns {import('../types').Game | null}
 */
export function toGame(row) {
  if (!row || typeof row !== 'object') return null;

  const uuid = row.uuid ?? row.game_uuid;
  if (!uuid) return null;

  const category = categoryFromType(row.type);
  const parameters = row.parameters ?? {};
  const images = row.images ?? {};

  /**
   * `uuid` is both the id and the slug.
   *
   * Phase 0 seeds `uuid` from our own slug, so `/play/:category/:slug` resolves
   * without a second lookup. A real sync writes Slotegrator's opaque uuid
   * instead and the URL becomes ugly but still correct — which is the right
   * trade, because a slug derived from the title would collide the first time
   * two studios ship a game with the same name.
   */
  const slug = String(uuid);

  const thumb = row.image || images.portrait || fallbackArt(category);

  return {
    id: slug,
    slug,
    title: row.name ?? slug,
    provider: row.provider ?? 'Unknown',
    category,
    thumb,
    // Search carries no `images`. Falling back to the portrait keeps the
    // featured rail rendering art rather than a hole; it is the wrong aspect
    // ratio, and that is visibly better than nothing.
    thumbWide: images.landscape || thumb,
    ...(BADGES.includes(row.label) ? { badge: row.label } : {}),
    // Undefined rather than 0: `GameList` treats absence as "cannot sort on
    // this", and 0 would sort a whole catalogue to the bottom while claiming
    // to know its RTP.
    rtp: num(parameters.rtp),
    volatility: VOLATILITY.includes(parameters.volatility) ? parameters.volatility : undefined,
    hitRatio: num(parameters.hitRatio),
    ...(num(parameters.players) === undefined ? {} : { players: num(parameters.players) }),
    ...(num(parameters.jackpot) === undefined ? {} : { jackpot: num(parameters.jackpot) }),
    /**
     * Whether the slot sells its bonus round, which is what
     * `/themes/bonus-buy-in` cuts on.
     *
     * Only ever set when the platform said `true`. An absent flag means "this
     * catalogue does not record the feature", not "this game does not have
     * it" — and a real Slotegrator sync records neither, so the theme comes
     * back empty rather than claiming every slot sells its bonus.
     */
    ...(parameters.bonusBuy === true ? { bonusBuy: true } : {}),
    /**
     * An in-house original is a `PLAY_*` socket event against casino-service,
     * not a provider iframe. Phase 5's `Play.jsx` branches on this; it is set
     * by the Phase 0 seeder and absent for everything a real sync writes.
     */
    ...(parameters.inHouse ? { inHouse: true, event: parameters.event ?? slug } : {}),
    /** Live-dealer tables have a lobby; the launch call differs. */
    hasLobby: Boolean(row.has_lobby),
  };
}

/**
 * A list of catalogue rows -> a list of `Game`s, unrenderable rows dropped.
 *
 * @param {unknown} rows
 * @returns {import('../types').Game[]}
 */
export function toGames(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(toGame).filter(Boolean);
}

/**
 * `GET /casino/games/recently-played` -> `Game`s.
 *
 * Rows are `{game_uuid, played_at, game}` and **`game` is null** for a title
 * that has left the catalogue since it was played. Those rows are dropped
 * rather than rendered as a placeholder: the Recents panel is a list of things
 * to play again, and a tile that cannot be launched does not belong in it.
 *
 * @param {unknown} rows
 * @returns {import('../types').Game[]}
 */
export function toRecentGames(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => toGame(row?.game ? { ...row.game, uuid: row.game.uuid ?? row.game_uuid } : null))
    .filter(Boolean);
}

/**
 * The value `GameList` should sort a game on, or `undefined` to exclude it.
 *
 * Volatility sorts on its rank rather than its name, so `high` beats `medium`
 * instead of `low` beating `medium` alphabetically.
 *
 * @param {import('../types').Game} game
 * @param {'rtp' | 'volatility' | 'hitRatio'} field
 * @returns {number | undefined}
 */
export function sortValue(game, field) {
  if (field === 'volatility') {
    const rank = VOLATILITY.indexOf(game?.volatility);
    return rank === -1 ? undefined : rank;
  }
  return num(game?.[field]);
}

export { VOLATILITY };
