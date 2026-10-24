'use strict';

/**
 * The game buckets a wagering race scores in.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS IS SHARED AND NOT PRIVATE TO EITHER SIDE
 *
 * Three services touch it. casino-service and sports-service classify their
 * own rows into these names; user-service multiplies each name by a number an
 * operator chose. It is a WIRE CONTRACT between them, and a bucket that one
 * side emits and the other has no multiplier for scores nothing — silently,
 * because a missing key reads as zero.
 *
 * ── `other` EXISTS BECAUSE THE REFERENCE DID NOT HAVE IT ─────────────────
 *
 * The implementation this is ported from bucketed with a SQL `CASE` whose
 * final arm was `ELSE slot_point`. Roulette, table games, casual games and
 * every row with an empty game type therefore scored as SLOTS — and the live
 * daily configuration had the slot multiplier at zero, so roughly a third of
 * all turnover earned exactly nothing while appearing to be counted.
 *
 * Nothing about that was visible: no bucket in the config was named for those
 * games, so there was no field an operator could have looked at and found
 * wrong. The fall-through is a bucket of its own here, with its own
 * multiplier, so "what happens to a game we did not classify" is an answer
 * somebody gives rather than an accident of `CASE` ordering.
 *
 * ── AND THE ARMS ARE ORDERED, NOT EXCLUSIVE ──────────────────────────────
 *
 * A game called "Casino Crash" matches both `casino` and `crash`. The order
 * below is the tie-break, and it is the same order on both sides, which is the
 * only reason the two agree. It goes most-specific first: `sports`, then the
 * two mechanics (`crash`, `slot`), then the broad `casino` catch-all, then
 * `other`.
 * ═════════════════════════════════════════════════════════════════════════
 */

/** In classification order. The first match wins. */
const RACE_BUCKETS = Object.freeze(['sports', 'crash', 'slot', 'casino', 'other']);

/**
 * The substrings that put a game type into a bucket, in the same order.
 *
 * Matched case-insensitively against whatever string the source calls a game
 * type — `js_games.game_type`, `gis_games.type`, or an in-house game's name.
 */
const BUCKET_KEYWORDS = Object.freeze({
  sports: ['sport', 'exchange', 'fancy'],
  crash: ['crash', 'aviator', 'limbo'],
  slot: ['slot'],
  casino: ['casino', 'live', 'table', 'roulette', 'baccarat', 'blackjack', 'poker', 'card'],
});

const DEFAULT_BUCKET = 'other';

/**
 * Which bucket a game type falls in.
 *
 * @param {string|null|undefined} gameType
 * @returns {string} one of `RACE_BUCKETS`
 */
function bucketFor(gameType) {
  const text = String(gameType ?? '').toLowerCase();
  if (!text) return DEFAULT_BUCKET;

  for (const bucket of RACE_BUCKETS) {
    const keywords = BUCKET_KEYWORDS[bucket];
    if (keywords?.some((word) => text.includes(word))) return bucket;
  }
  return DEFAULT_BUCKET;
}

/**
 * `bucketFor` as a SQL expression, for the aggregates that cannot round-trip
 * every row through JavaScript.
 *
 * Built from the same table above, so the two cannot drift — which they would
 * within a release if the SQL were written out by hand next to it.
 *
 * @param {string} column  A SQL expression yielding the game type. Must be
 *   code, never user input: it is interpolated.
 */
function bucketCaseSql(column) {
  const arms = RACE_BUCKETS.filter((b) => BUCKET_KEYWORDS[b]).map((bucket) => {
    const tests = BUCKET_KEYWORDS[bucket].map((word) => `LOWER(COALESCE(${column}, '')) LIKE '%${word}%'`);
    return `WHEN ${tests.join(' OR ')} THEN '${bucket}'`;
  });

  return `CASE ${arms.join(' ')} ELSE '${DEFAULT_BUCKET}' END`;
}

module.exports = { RACE_BUCKETS, BUCKET_KEYWORDS, DEFAULT_BUCKET, bucketFor, bucketCaseSql };
