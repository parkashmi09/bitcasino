'use strict';

/** Which aggregator a settlement belongs to. */
const AGGREGATOR = Object.freeze({ ASIA: 'asia', NEXUS: 'nexus', EVO: 'evo' });

/**
 * asiaapi.net (`/processRequest`) speaks a `{status, error}` envelope.
 *
 * `status: "fail"` with an `error` string is how it expects a refusal, and its
 * client reads that rather than the HTTP code — so refusals are 200s here for
 * the same reason as every other provider in this codebase.
 */
const ASIA_ERROR = Object.freeze({
  BAD_PARAMS: 'Invalid request parameters',
  NO_BALANCE: 'fail_balance',
  UNKNOWN_CMD: 'Unknown command',
  INTERNAL: 'INTERNAL_ERROR',
  UNAUTHORISED: 'UNAUTHORISED',
});

/** nexusggreu.com (`/gold_api`) speaks `{status: 0|1, msg}`. */
const NEXUS_MSG = Object.freeze({
  SUCCESS: 'SUCCESS',
  INVALID_METHOD: 'INVALID_METHOD',
  INVALID_GAME_TYPE: 'INVALID_GAME_TYPE',
  INSUFFICIENT: 'INSUFFICIENT_USER_FUNDS',
  INTERNAL: 'INTERNAL_ERROR',
  SITE_ERROR: 'SITE_ERROR_1',
  UNAUTHORISED: 'UNAUTHORISED',
});

/**
 * The wallet currency each aggregator settles in.
 *
 * All three settled `credits.usdt` unconditionally in legacy — asiaapi even
 * answered `currency: "USD"` in its responses while moving the USDT column.
 * That is preserved, because changing which balance the casino settles against
 * is a product decision with a reconciliation behind it, not a port detail. It
 * is declared here rather than left implicit in a query.
 */
const SETTLEMENT_CURRENCY = 'USDT';

/** What asiaapi calls the currency in its responses. Display only. */
const ASIA_DISPLAY_CURRENCY = 'USD';

/** Nexus splits its transaction payload by game type. */
const NEXUS_GAME_TYPES = Object.freeze(['live', 'slot']);

module.exports = {
  AGGREGATOR,
  ASIA_ERROR,
  NEXUS_MSG,
  SETTLEMENT_CURRENCY,
  ASIA_DISPLAY_CURRENCY,
  NEXUS_GAME_TYPES,
};
