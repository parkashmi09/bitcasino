'use strict';

const { defineErrors } = require('@ibitplay/common');

/**
 * Errors for this integration.
 *
 * The HTTP status here is for our own logs and monitoring. The PROVIDER reads
 * the body and matches on ITS numbers — that mapping lives in
 * `providerCodes.js`, so the shared error catalogue keeps no notion of a third
 * party's numbering.
 */
module.exports = defineErrors('XCASINO', {
  BAD_SIGNATURE: {
    status: 401,
    message: 'Invalid hash',
  },

  STALE_REQUEST: {
    status: 401,
    /**
     * Legacy signed `request_timestamp` and never compared it to a clock, so a
     * captured request stayed valid forever.
     */
    message: 'Request timestamp is outside the accepted window',
  },

  INVALID_SESSION: {
    status: 404,
    message: 'Invalid session',
  },

  SESSION_EXPIRED: {
    status: 404,
    // Legacy sessions never expired — a `game_runs` row from a year ago still
    // authenticated a balance change.
    message: 'Session has expired',
  },

  PLAYER_NOT_FOUND: {
    status: 404,
    message: 'User not found',
  },

  PLAYER_LOCKED: {
    status: 403,
    /**
     * Legacy checked nothing here, so an account the operator had locked —
     * usually because money was going missing through it — could still launch
     * a casino game.
     */
    message: 'That account cannot play casino games',
  },

  INSUFFICIENT_FUNDS: {
    status: 422,
    // From the ROW COUNT of a guarded update, not from a balance read taken
    // beforehand.
    message: 'Insufficient balance',
  },

  UNSUPPORTED_COIN: {
    status: 422,
    /**
     * The refusal that closes the injection. Legacy interpolated this value
     * into `UPDATE credits SET ${coin} = $1` and it originated in an
     * unauthenticated request body.
     */
    message: 'That currency is not held on this platform',
  },

  CURRENCY_MISMATCH: {
    status: 422,
    message: 'That currency does not match the session',
  },

  UNKNOWN_TRANSACTION_TYPE: {
    status: 422,
    message: 'Unknown transaction type',
  },

  NEGATIVE_AMOUNT: {
    status: 422,
    // A negative BET is a credit wearing a debit's name.
    message: 'An amount may not be negative',
  },

  DUPLICATE_TRANSACTION: {
    status: 409,
    message: 'That transaction has already been recorded',
  },

  TRANSACTION_NOT_FOUND: {
    status: 404,
    message: 'No such transaction',
  },

  CANNOT_CANCEL: {
    status: 422,
    // Only a stake can be handed back; clawing a WIN out of a wallet the
    // player may already have spent from is a different operation.
    message: 'Only a bet may be cancelled',
  },

  NOT_CONFIGURED: {
    status: 503,
    /**
     * Legacy hardcoded both game-run hosts in the handler. An unconfigured
     * deployment should fail loudly rather than send players to a host the
     * code was compiled with.
     */
    message: 'The casino integration is not configured',
  },
});
