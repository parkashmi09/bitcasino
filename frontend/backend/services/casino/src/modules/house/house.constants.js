'use strict';

/** What `reset` puts the ceiling back to. Legacy's literal 50. */
const DEFAULT_MAX = 50;

/**
 * The 70/30 split, from legacy's own comment:
 *
 *     // Illusion logic with a 70-30 win-loss ratio
 *     const winProbability = 0.7;
 *
 * Kept unchanged — what the counters do is a product decision, and this is a
 * port.
 *
 * "Illusion" describes the WALK, not the effect. Crossing `current` past `max`
 * is what stops a player winning in sixteen games — see the module header.
 */
const WIN_PROBABILITY = 0.7;

/**
 * A ceiling on the counters.
 *
 * Legacy clamped them at zero and nowhere else. The loss branch increments
 * `max` with no bound, so a row that stays in it long enough grows without
 * limit — over months of one tick a minute that is a number nobody intended.
 */
const MAX_COUNTER = 10_000;

/**
 * How often the ticker runs.
 *
 * Legacy used `cron.schedule('* * * * *', …)` — once a minute. A plain
 * interval here rather than a cron expression: the schedule has no calendar
 * component, and `node-cron` is a dependency this service otherwise does not
 * need.
 */
const TICK_INTERVAL_MS = 60_000;

module.exports = { DEFAULT_MAX, WIN_PROBABILITY, MAX_COUNTER, TICK_INTERVAL_MS };
