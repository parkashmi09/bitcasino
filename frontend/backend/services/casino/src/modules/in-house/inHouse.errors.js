'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('INHOUSE', {
  UNSUPPORTED_COIN: {
    status: 422,
    /**
     * The refusal that keeps the coin out of the SQL. Legacy interpolated
     * `_.lowerCase(coin)` into `UPDATE credits SET ${coin} = ...`.
     */
    message: 'That currency cannot be played with',
  },

  INVALID_STAKE: {
    status: 422,
    // Legacy had four consecutive `bet <= 0` comparisons, which are one check.
    message: 'That stake is not valid',
  },

  INSUFFICIENT_BALANCE: {
    status: 422,
    /**
     * From the ROW COUNT of the guarded debit. Legacy read the balance in
     * `CanPlay`, compared it in JavaScript, and debited unconditionally
     * several callbacks later.
     */
    message: 'Your balance is not enough',
  },

  BET_NOT_FOUND: { status: 404, message: 'No such bet' },

  ALREADY_SETTLED: {
    status: 409,
    /**
     * Legacy's `updateBetAfterFinish` was an unconditional UPDATE keyed on a
     * colliding `gid`, so a duplicate settle paid twice.
     */
    message: 'That bet has already been settled',
  },

  UNKNOWN_GAME: { status: 404, message: 'No such game' },

  ROUND_ALREADY_OPEN: {
    status: 409,
    /**
     * Legacy's `Queue.exists(id)` — which was skipped entirely for plinko
     * (`if (game === "plinko") exists = false;`), so that game could have
     * several rounds open at once. A partial unique index enforces it now.
     */
    message: 'You already have a round of that game open',
  },

  NO_OPEN_ROUND: {
    status: 404,
    /**
     * Legacy answered this with `console.log('Client Not Playing!')` and
     * dropped the message — the client waited for a reply that never came,
     * with its stake already taken. Under `cluster` that happened whenever a
     * cash-out landed on a different worker from the one that opened the round.
     */
    message: 'You have no round of that game open',
  },
});
