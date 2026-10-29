'use strict';

const { RACE_BUCKETS } = require('@ibitplay/common');

/**
 * The wagering race's vocabulary.
 */

/** The two races. `race_config.type` and `races.type` are CHECKed against this. */
// rainbet: `monthly` added (migration 168).
const RACE_TYPES = Object.freeze(['daily', 'weekly', 'monthly']);

/** The `race_boats` (booked seats) columns per race type. */
const BOAT_FIELDS = Object.freeze({
  daily: { points: 'daily_points', rank: 'daily_rank' },
  weekly: { points: 'weekly_points', rank: 'weekly_rank' },
  monthly: { points: 'monthly_points', rank: 'monthly_rank' },
});

/** How long a race of each type may run, in days (a hand-made race is checked against it). */
const MAX_RACE_DAYS = Object.freeze({ daily: 1, weekly: 7, monthly: 31 });

const RACE_LABEL = Object.freeze({ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' });

/** `cancelled`: closed by staff with no prizes (migration 078). */
const RACE_STATUS = Object.freeze({ OPEN: 'open', SETTLED: 'settled', CANCELLED: 'cancelled' });

/**
 * Which config column holds each bucket's multiplier.
 *
 * Derived from `RACE_BUCKETS` at load rather than written out, so a bucket
 * added to the shared list without a column here fails loudly at boot instead
 * of scoring zero in silence — which is the exact failure mode the `other`
 * bucket exists to prevent.
 */
const BUCKET_COLUMN = Object.freeze(
  Object.fromEntries(RACE_BUCKETS.map((bucket) => [bucket, `${bucket}_points`]))
);

/**
 * Prizes are denominated in USDT.
 *
 * Points are computed in USD — every source is converted through
 * `exchangerate.usd_rate` — and USDT is this platform's USD-equivalent wallet
 * column. Named here rather than hardcoded at the credit, because "which
 * balance does a race prize land in" is a product decision that should be
 * visible in one place.
 */
const PRIZE_CURRENCY = 'USDT';

/** The ledger reason. It appears in the player's statement. */
const REASON = Object.freeze({ CLAIM: 'race_reward_claim' });

/**
 * How the prize curve tapers.
 *
 * Two geometric decays, one for the podium and one for everyone below it. A
 * single curve across all N ranks either makes rank 1 enormous or rank 3
 * indistinguishable from rank 4; splitting them lets an operator set the
 * podium's share separately from its shape.
 */
const TOP3_DECAY = 0.5;
const REST_DECAY = 0.8;

/** How many ranks count as the podium. */
const PODIUM_SIZE = 3;

/**
 * A hard ceiling on `winner_count`.
 *
 * The leaderboard is capped at the number of paid ranks, so this is also the
 * largest board a player can be shown. Past a few hundred the per-rank prize is
 * dust and the payload is the expensive part.
 */
const MAX_WINNERS = 500;

/**
 * The smallest prize worth writing.
 *
 * A geometric taper across 500 ranks produces amounts below a satoshi at the
 * tail. Those rows cost a claim each and credit nothing, so settlement stops
 * before them and the player simply is not a winner.
 */
const MIN_REWARD = '0.01';

module.exports = {
  RACE_TYPES,
  BOAT_FIELDS,
  MAX_RACE_DAYS,
  RACE_LABEL,
  RACE_STATUS,
  RACE_BUCKETS,
  BUCKET_COLUMN,
  PRIZE_CURRENCY,
  REASON,
  TOP3_DECAY,
  REST_DECAY,
  PODIUM_SIZE,
  MAX_WINNERS,
  MIN_REWARD,
};
