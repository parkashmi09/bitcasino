'use strict';

const { defineErrors } = require('@ibitplay/common');

/**
 * The module had no errors file — every refusal in it was a validator's.
 * `GET /casino/bet-history/:betId` is the first route here that can be asked
 * for something specific and correctly have nothing to give.
 */
module.exports = defineErrors('BETHISTORY', {
  /**
   * 404 for a bet that is not the caller's AND for one that does not exist.
   *
   * The same answer for both is the point: ids are sequential, so a 403 on
   * somebody else's bet and a 404 on a free id would let anyone walk the
   * sequence and learn exactly which ids are real bets. `myBet` puts the
   * ownership test in the `where` so the two cases are indistinguishable to
   * the code as well as to the caller.
   */
  BET_NOT_FOUND: {
    status: 404,
    message: 'No such bet',
  },
  /** A per-player staff route asked about a player outside the caller's tree (404, as elsewhere). */
  PLAYER_NOT_IN_YOUR_TREE: {
    status: 404,
    message: 'Player not found',
  },
});
