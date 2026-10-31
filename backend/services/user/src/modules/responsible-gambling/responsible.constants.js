'use strict';

/** What a break covers. PLATFORM is the whole account: no stakes anywhere, no sign-in. */
const EXCLUSION_TYPE = Object.freeze({ CASINO: 'CASINO', SPORTS: 'SPORTS', PLATFORM: 'PLATFORM' });

/** The two limits a player may hold — at most one live of each. */
const LIMIT_TYPE = Object.freeze({ LOSS_LIMIT: 'LOSS_LIMIT', WAGER_LIMIT: 'WAGER_LIMIT' });

/** The window a limit is measured over; it restarts on the anniversary of the limit's creation. */
const PERIOD_UNIT = Object.freeze({ DAYS: 'DAYS', WEEKS: 'WEEKS', MONTHS: 'MONTHS' });

/**
 * The break lengths the player can pick after the cooldown — the player site's list. Permanent
 * has no column of its own: it is written 999 years out, and anything over a century reads as
 * permanent (the reference does the same).
 */
const BREAK_PERIODS = Object.freeze({
  '1 day': { days: 1 },
  '1 week': { days: 7 },
  '1 month': { months: 1 },
  '6 months': { months: 6 },
  '1 year': { months: 12 },
  '2 years': { months: 24 },
  '3 years': { months: 36 },
  '5 years': { months: 60 },
  '10 years': { months: 120 },
  permanent: { months: 999 * 12 },
});

/** The opening cooldown, fixed. */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** A limit asked to go keeps applying this long, so it cannot be lifted mid-session. */
const LIMIT_REMOVAL_DELAY_MS = 12 * 60 * 60 * 1000;

const PERMISSION = Object.freeze({ READ: 'users:read' });

module.exports = {
  EXCLUSION_TYPE,
  LIMIT_TYPE,
  PERIOD_UNIT,
  BREAK_PERIODS,
  COOLDOWN_MS,
  LIMIT_REMOVAL_DELAY_MS,
  PERMISSION,
};
