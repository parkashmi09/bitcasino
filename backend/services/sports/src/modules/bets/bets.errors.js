'use strict';

/**
 * NOTHING IMPORTS THIS ANY MORE — and that is deliberate.
 *
 * `bets.service.js` is a verbatim port of the legacy place-bet handler, so it
 * answers what that handler answered: `{success:false, message}` at 400, or
 * `{success:false, code, message}` at 403 with the odds guard's own codes
 * (`ODDS_CHANGED`, `MARKET_SUSPENDED`, `SELECTION_NOT_FOUND`, ...). The board
 * parses that shape.
 *
 * Kept because it is the catalogue of what each refusal MEANS, in one place,
 * and because a future move back to a typed envelope starts here rather than
 * from nothing.
 */

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('BETS', {
  BETTING_LOCKED: {
    status: 403,
    message: 'Sports betting is not available on this account',
  },

  MARKET_NOT_FOUND: {
    status: 404,
    /**
     * Legacy never looked the market up at all — every detail of it came from
     * the request body, so there was nothing to not find.
     */
    message: 'That market is not open for betting',
  },

  SELECTION_NOT_IN_MARKET: {
    status: 422,
    // `selection_name` was free text in legacy and was written straight onto
    // the bet row, so a bet could name a runner the market does not have.
    message: 'That selection is not part of this market',
  },

  ODDS_REJECTED: {
    status: 409,
    /**
     * The price moved, or was never offered.
     *
     * Legacy took `odds` from the request body and never compared it to
     * anything, so a back bet at `odds: 1000` paid stake × 999.
     */
    message: 'The price has changed — please review and place the bet again',
  },

  STAKE_OUT_OF_RANGE: { status: 422, message: 'That stake is outside the limits for this market' },

  PAYOUT_TOO_LARGE: {
    status: 422,
    // The platform's own ceiling. Legacy had none, so one bet could commit an
    // unbounded liability.
    message: 'That bet would exceed the maximum payout allowed on a single bet',
  },

  INSUFFICIENT_FUNDS: { status: 402, message: 'There is not enough in your balance to cover this bet' },

  BET_NOT_FOUND: { status: 404, message: 'Bet not found' },
});
