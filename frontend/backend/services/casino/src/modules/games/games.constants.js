'use strict';

/**
 * The curated lobby collections.
 *
 * Each is a single row in its own table holding a comma-separated list of game
 * uuids, in display order. Five tables with identical shapes, because that is
 * how they were built — collapsing them into one keyed table is a data
 * migration, not a port, so the shape is preserved and the duplication is
 * expressed once, here, instead of five times in the service.
 *
 * `key` is the literal value legacy wrote into each table's `key` column.
 */
const COLLECTIONS = Object.freeze({
  hot: { model: 'HotGames', key: 'hotgames', label: 'Hot games' },
  'live-casino': { model: 'LiveCasino', key: 'livecasino', label: 'Live casino' },
  'popular-slots': { model: 'PopularSlots', key: 'popularslots', label: 'Popular slots' },
  crash: { model: 'CrashGames', key: 'crashgames', label: 'Crash games' },
  indian: { model: 'IndianGames', key: 'indiangames', label: 'Indian games' },
});

const COLLECTION_SLUGS = Object.freeze(Object.keys(COLLECTIONS));

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

module.exports = {
  COLLECTIONS,
  COLLECTION_SLUGS,
  GAME_FIELDS,
  GAME_SUMMARY_FIELDS,
  MAX_COLLECTION_SIZE,
  RECENTLY_PLAYED_LIMIT,
};
