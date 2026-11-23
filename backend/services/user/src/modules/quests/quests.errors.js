'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('QUEST', {
  NOT_FOUND: { status: 404, message: 'No such quest' },
  /** details `{ key, progress, target }` */
  NOT_COMPLETED: { status: 422, message: 'Complete the quest before claiming it' },
  /** The owner set no reward for this quest. */
  NO_REWARD: { status: 422, message: 'This quest has no reward' },
  /** Already paid in this period (today). */
  ALREADY_CLAIMED: { status: 409, message: 'You already claimed this quest today' },
  /** An agent's player, a demo account, or a site with promotions off. */
  NOT_ELIGIBLE: { status: 403, message: 'Quest rewards are not available on this account' },
});
