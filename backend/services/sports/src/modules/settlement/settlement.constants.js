'use strict';

/**
 * Settlement vocabulary.
 *
 * These strings were scattered as literals across `legacy/mannualsettlement/`
 * — the fancy market list appeared inline in one handler, the status values in
 * six. A typo in any of them silently matched zero rows, which in a settlement
 * routine means "nobody got paid" rather than an error.
 */

/**
 * Lifecycle of a row in "SportsBet".status.
 *
 * One definition, in the module that places the bets — re-exported here so the
 * settlement path and the bet-list validators cannot disagree about what the
 * column may hold.
 */
const { BET_STATUS } = require('../bets/bets.constants');

/** Outcome recorded on a bet once it leaves `open`. */
const RESULT_STATUS = Object.freeze({
  REFUNDED: 'refunded',
  VOIDED_AFTER_SETTLEMENT: 'voided_after_settlement',
});

/** Game type on a bet — which betting product it came from. */
const GAME_TYPE = Object.freeze({
  MATCH_ODDS: 'MO',
  BOOKMAKER: 'BM',
  FANCY: 'FAN',
});

/** The two market families `getMoMatches` aggregates over. */
const MARKET_GAME_TYPES = Object.freeze([GAME_TYPE.MATCH_ODDS, GAME_TYPE.BOOKMAKER]);

/**
 * Market types that identify a single fancy *session* rather than a whole
 * market. For these, `selection_name` is part of the identity: two sessions on
 * one match are different markets, and settling one must not touch the other.
 *
 * Legacy carried two overlapping copies of this list — a 25-entry array in
 * `getFanOpenBets` used for grouping, and a 7-entry array in `declareResult`
 * used to decide whether to filter by `selection_name`. The 7-entry version is
 * the one that gates a WRITE, so it is kept separate and named for what it does.
 */
const SELECTION_SCOPED_MARKETS = Object.freeze([
  'fancy1',
  'oddeven',
  'Over By Over',
  'Ball By Ball',
  'khado',
  'meter',
  'Normal',
]);

/** Every market type presented as its own bucket in the fancy open-bets view. */
const FANCY_MARKET_TYPES = Object.freeze([
  '1st Innings 6 Overs Line',
  '2nd Innings 6 Overs Line',
  '3rd Innings 6 Overs Line',
  '1st Innings 50 Overs Line',
  '2nd Innings 50 Overs Line',
  '3rd Innings 50 Overs Line',
  '1st Innings 40 Overs Line',
  '2nd Innings 40 Overs Line',
  '3rd Innings 40 Overs Line',
  '1st Innings 30 Overs Line',
  '2nd Innings 30 Overs Line',
  '3rd Innings 30 Overs Line',
  '1st Innings 20 Overs Line',
  '2nd Innings 20 Overs Line',
  '3rd Innings 20 Overs Line',
  '1st Innings 10 Overs Line',
  '2nd Innings 10 Overs Line',
  '3rd Innings 10 Overs Line',
  'Over By Over',
  'Ball By Ball',
  'Normal',
  'khado',
  'meter',
  'fancy1',
  'oddeven',
]);

/** Bucket for any market type not in `FANCY_MARKET_TYPES`. */
const OTHER_BUCKET = 'others';

/** `credits_ledger.reason` values this module writes. */
const LEDGER_REASON = Object.freeze({
  VOID_AFTER_SETTLEMENT: 'VOID_AFTER_SETTLEMENT',
  VOID_SINGLE_BET_AFTER_SETTLEMENT: 'VOID_SINGLE_BET_AFTER_SETTLEMENT',
});

/**
 * Settlement money is denominated in INR on `credits.inr`, matching the legacy
 * behaviour. Every ledger row this module writes carries it explicitly rather
 * than relying on a column default.
 */
const SETTLEMENT_CURRENCY = 'INR';

/** Staff audit actions, so the strings match between route and audit query. */
const ACTIVITY = Object.freeze({
  DECLARE_RESULT: 'settle.declare-result',
  VOID_MARKET: 'settle.void-market',
  VOID_BET: 'settle.void-bet',
  VOID_MARKET_AFTER: 'settle.void-market-after',
  VOID_BET_AFTER: 'settle.void-bet-after',
});

/**
 * Permissions required by the admin routes, resolved from the live staff record
 * by admin-service. Names come from `@ibitplay/auth` PERMISSIONS — the platform
 * format is `resource:action`, and `hasPermission` understands `sports:*`.
 */
const PERMISSION = Object.freeze({
  READ: 'sports:read',
  DECLARE: 'sports:settle',
  VOID: 'sports:settle',
  // Deliberately NOT `sports:settle`: reversing a paid-out market is a bigger
  // power than settling one, so widening settle must not grant it.
  VOID_AFTER_SETTLEMENT: 'sports:void-settled',
});

module.exports = {
  BET_STATUS,
  RESULT_STATUS,
  GAME_TYPE,
  MARKET_GAME_TYPES,
  SELECTION_SCOPED_MARKETS,
  FANCY_MARKET_TYPES,
  OTHER_BUCKET,
  LEDGER_REASON,
  SETTLEMENT_CURRENCY,
  ACTIVITY,
  PERMISSION,
};
