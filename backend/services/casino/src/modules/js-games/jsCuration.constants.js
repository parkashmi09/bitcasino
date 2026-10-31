'use strict';

/**
 * The curated lists an operator can build over `js_games`.
 *
 * ── WHY THESE SLUGS ──────────────────────────────────────────────────────
 *
 * All but `trending` mirror the aggregator collections in `games.constants.js`,
 * so the admin screens keep the vocabulary operators already use. `trending`
 * is new and is the home page's own row — the one the site rendered from a
 * hard-coded file (`src/Pages/homePage/trendingGamesData.js`, twenty games
 * transcribed from a screenshot) with no way for an operator to change it.
 *
 * A collection missing from this list is a 404 rather than an empty list. The
 * difference matters to the caller: "no such collection" is a bug in the
 * caller, "this collection is empty" is a state an operator chose.
 */
const COLLECTIONS = Object.freeze({
  trending: { label: 'Trending games' },
  hot: { label: 'Hot games' },
  'live-casino': { label: 'Live casino' },
  'popular-slots': { label: 'Popular slots' },
  crash: { label: 'Crash games' },
});

const COLLECTION_SLUGS = Object.freeze(Object.keys(COLLECTIONS));

/** The three kinds of curated list. Matches the CHECK on `js_game_curation.scope`. */
const SCOPES = Object.freeze({ VENDOR: 'vendor', TYPE: 'type', COLLECTION: 'collection' });

const SCOPE_VALUES = Object.freeze(Object.values(SCOPES));

/**
 * Columns a curated response exposes.
 *
 * Explicit, for the reason `games.constants.js` gives: `SELECT *` grows the
 * payload every time the provider sync adds a column, and nobody decides it.
 */
const GAME_FIELDS = Object.freeze(['id', 'game_uid', 'game_name', 'game_type', 'game_icon', 'vendor', 'is_active']);

/**
 * How many games one curated list may hold.
 *
 * The list is a CSV in a single TEXT column and is read on lobby requests, so
 * it is not somewhere to put the whole catalogue. 500 uids is roughly 16 KB.
 */
const MAX_LIST_SIZE = 500;

module.exports = { COLLECTIONS, COLLECTION_SLUGS, SCOPES, SCOPE_VALUES, GAME_FIELDS, MAX_LIST_SIZE };
