'use strict';

/**
 * Third-party sportsbook aggregator — constants.
 *
 * Everything here was a literal in `legacy/sportsbook/controller.js`, including
 * the merchant credentials, which are in the repository history and have to be
 * rotated with Slotegrator (see `docs/ROTATION.md`).
 */

/** Lifecycle of a row in `sportsbook_sessions`. */
const SESSION_STATUS = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
});

/**
 * Currencies the provider does not know by our name.
 *
 * Legacy did this inline in two places:
 *
 *     currency: currency.toLowerCase() === 'usdt' ? 'USD' : currency
 *
 * — once in `init` and once in `refresh-token`. Two copies of a mapping is one
 * copy away from a session opened in a currency the wallet does not hold.
 */
const PROVIDER_CURRENCY = Object.freeze({
  USDT: 'USD',
});

/**
 * How long a session may sit open before it is considered abandoned.
 *
 * Legacy had no such notion — no session was stored, so nothing could expire.
 * The unique index in migration 031 allows one open session per player per
 * book, so without an expiry a player whose browser crashed mid-session could
 * never open that book again.
 */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Provider paths. Relative to `SPORTSBOOK_BASE_URL`. */
const PATHS = Object.freeze({
  LIST: '/sportsbooks',
  INIT: '/sportsbooks/init',
  LOGOUT: '/sportsbooks/logout',
});

/** How long the book list is cached. It changes about never. */
const LIST_CACHE_MS = 5 * 60 * 1000;

module.exports = { SESSION_STATUS, PROVIDER_CURRENCY, SESSION_TTL_MS, PATHS, LIST_CACHE_MS };
