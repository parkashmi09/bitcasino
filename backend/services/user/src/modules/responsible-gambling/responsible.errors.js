'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('RESPONSIBLE', {
  /** A stake while a break covering it is in force. details `{ type, until }` */
  SELF_EXCLUDED: {
    status: 403,
    message: 'You are on a break from gambling until it ends',
  },

  /** details `{ type, limitUsd, usedUsd, stakeUsd, resetsAt }` */
  WAGER_LIMIT_REACHED: {
    status: 403,
    message: 'This bet would go over your wager limit',
  },

  /** details `{ type, limitUsd, usedUsd, stakeUsd, resetsAt }` */
  LOSS_LIMIT_REACHED: {
    status: 403,
    message: 'This bet could go over your loss limit',
  },

  /** A second live limit of a kind the player already holds. */
  LIMIT_EXISTS: {
    status: 409,
    message: 'You already have a limit of this type',
  },

  /** Same 404 for "not yours" as for "does not exist". */
  LIMIT_NOT_FOUND: {
    status: 404,
    message: 'No such limit',
  },

  /** A break chosen without the cooldown having been taken first. */
  COOLDOWN_REQUIRED: {
    status: 422,
    message: 'Take the 24-hour cooldown before choosing a longer break',
  },

  /** A stake whose USD value cannot be worked out while a limit applies: refused, never waved through. */
  NO_RATE: {
    status: 400,
    message: 'Bets in this currency are not available right now',
  },
});
