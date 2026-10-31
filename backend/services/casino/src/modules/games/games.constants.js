'use strict';

/**
 * The curated lobby collections.
 *
 * Each is a single row in its own table holding a comma-separated list of game
 * uuids, in display order. Four tables with identical shapes, because that is
 * how they were built — collapsing them into one keyed table is a data
 * migration, not a port, so the shape is preserved and the duplication is
 * expressed once, here, instead of four times in the service.
 *
 * `key` is the literal value legacy wrote into each table's `key` column.
 *
 * There was a fifth, `indian` (`indian_games`). The site no longer has an
 * Indian games section, so it is not served or listed; the table and its model
 * stay, with their rows, so nothing is dropped.
 */
const COLLECTIONS = Object.freeze({
  hot: { model: 'HotGames', key: 'hotgames', label: 'Hot games' },
  'live-casino': { model: 'LiveCasino', key: 'livecasino', label: 'Live casino' },
  'popular-slots': { model: 'PopularSlots', key: 'popularslots', label: 'Popular slots' },
  crash: { model: 'CrashGames', key: 'crashgames', label: 'Crash games' },
});

const COLLECTION_SLUGS = Object.freeze(Object.keys(COLLECTIONS));

/** `/casino/:tab` segments the site keeps for itself; a lobby category may not take one. */
const RESERVED_TABS = Object.freeze(['', 'lobby', 'brand', 'originals', 'provider', 'themes']);

/**
 * What a seeded lobby category shows while it has no hand-picked games — the same list the
 * site reads then (frontend services/catalog.js SET_QUERY; keep the two in step). The admin
 * opens an uncurated category on this list so it can be edited rather than started blank.
 */
const CATEGORY_AUTO_LISTS = Object.freeze({
  hot: { collection: 'hot' },
  slots: { category: 'slots' },
  live: { category: 'live' },
  'game-shows': { category: 'game-shows' },
  'table-game': { category: 'table' },
  blackjack: { category: 'blackjack' },
  roulette: { category: 'roulette' },
  baccarat: { category: 'baccarat' },
  poker: { category: 'poker' },
  'crash-games': { category: 'crash' },
});

/** How much of an automatic list the admin is shown to edit. */
const AUTO_LIST_ADMIN_LIMIT = 500;

/** A category's URL key from its name: "Hot Games" -> `hot-games`. */
const categorySlug = (name) =>
  String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/**
 * Columns a lobby response may expose.
 *
 * Legacy answered these endpoints with `SELECT g.*`, which is why the payload
 * grew a column every time the sync did. An explicit list means a new upstream
 * field reaches players when someone decides it should.
 */
const GAME_FIELDS = Object.freeze([
  'uuid',
  'name',
  'provider',
  'provider_id',
  'type',
  'image',
  'technology',
  'has_lobby',
  'is_mobile',
  'has_freespins',
  'freespin_valid_until_full_day',
  'label',
  'parameters',
  'tags',
  'images',
  'created_at',
  'updated_at',
]);

/** The short shape used by admin pickers and search results. */
const GAME_SUMMARY_FIELDS = Object.freeze(['uuid', 'name', 'provider', 'image', 'type', 'is_mobile', 'has_freespins']);

/** How many games a curated collection may hold. */
const MAX_COLLECTION_SIZE = 5000;

/** How many entries a recently-played list keeps, per player. */
const RECENTLY_PLAYED_LIMIT = 15;

/**
 * How many games one player may star.
 *
 * A favourite reference is stored as the client gives it and is not checked
 * against a catalogue (see migration 038 for why), so this is the bound that
 * stops the table being used as free per-account storage. Generous enough that
 * no real player will meet it: the whole aggregator catalogue is thousands of
 * games and nobody stars five hundred.
 */
const FAVOURITES_LIMIT = 500;

/**
 * `?sort=popular`: what players opened most, counted as distinct players per game over
 * the last `POPULAR_WINDOW_DAYS` of launches (`game_sessions`), top `POPULAR_LIMIT` only.
 * Distinct players, not launches, so one player reopening a game does not lift it.
 */
const POPULAR_WINDOW_DAYS = 30;
const POPULAR_LIMIT = 500;

/**
 * How long the popularity ranking and the slug-collision list are reused. Both are
 * whole-catalogue reads that change slowly; a minute stale is invisible to a player.
 */
const LIST_CACHE_MS = 60_000;

/**
 * Categories the import never tagged, matched by game name instead (Postgres
 * case-insensitive regex). The lobby's Roulette / Blackjack / Baccarat / Poker / Game shows
 * tabs ask for these like any other `?category=`. `tag` narrows the match to one
 * normalised tag first: game shows are live games, and a "Lucky 7" slot isn't one.
 *
 * Checked against the catalogue on 2026-10-09: roulette 91, blackjack 136,
 * baccarat 130, poker 10, game shows 20.
 */
const NAME_CATEGORIES = Object.freeze({
  roulette: { pattern: 'roulette|roleta|ruleta' },
  blackjack: { pattern: 'black ?jack' },
  baccarat: { pattern: 'baccarat|punto banco|bac bo|mega sic bac' },
  poker: { pattern: "poker|hold.?em|stud\\M" },
  'game-shows': {
    tag: 'live',
    pattern: [
      'crazy time', 'crazy pachinko', 'dream catcher', 'deal or no deal', 'mega ball', 'mega bola', 'funky time',
      'monopoly', 'mega wheel', 'cash wheel', 'cash or crash', 'boom city', 'candyland', 'imperial quest',
      'treasure island', 'wanderlust', 'vegas ball', 'snakes & ladders', 'bet on numbers', 'lucky 7',
    ].join('|'),
  },
});

/**
 * The same categories for a catalogue whose rows carry no normalised tag — Slotegrator's
 * `tags` are `{ code, label }` objects, not the import's one word (see `#filterClause`). Its
 * games are matched by their own `type` (trimmed, lowercased) instead, and "live" by provider:
 * Slotegrator types a live blackjack table `blackjack`, the same word as an RNG one.
 *
 * Checked against the Slotegrator catalogue (1,710 games) on 2026-10-14.
 */
const LIVE_PROVIDERS = Object.freeze([
  'evolution gaming', 'pragmaticplaylive', 'ezugi', 'sa gaming', 'iconic21', 'vivogaming', 'xprogaming', 'betgames',
  'hogaming', 'smartbet',
]);
const LIVE_TYPES = Object.freeze(['live dealer', 'game show', 'game shows', 'game_shows']);
const TYPE_CATEGORIES = Object.freeze({
  slots: ['slots', 'slot', 'video slot', 'slot game'],
  crash: ['crash', 'instant win', 'instant game'],
  lottery: ['lottery', 'keno', 'bingo', 'scratch card'],
  arcade: ['casual'],
  // Table games that are NOT live (a live provider's table is `live`).
  table: ['table', 'card', 'poker', 'blackjack', 'baccarat', 'roulette', 'sic bo', 'dragon tiger', 'teen patti', 'andar bahar'],
});

module.exports = {
  LIVE_PROVIDERS,
  LIVE_TYPES,
  TYPE_CATEGORIES,
  NAME_CATEGORIES,
  COLLECTIONS,
  COLLECTION_SLUGS,
  RESERVED_TABS,
  categorySlug,
  CATEGORY_AUTO_LISTS,
  AUTO_LIST_ADMIN_LIMIT,
  GAME_FIELDS,
  GAME_SUMMARY_FIELDS,
  MAX_COLLECTION_SIZE,
  RECENTLY_PLAYED_LIMIT,
  FAVOURITES_LIMIT,
  POPULAR_WINDOW_DAYS,
  POPULAR_LIMIT,
  LIST_CACHE_MS,
};
