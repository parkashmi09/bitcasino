'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('RELOAD', {
  NOT_AVAILABLE: { status: 409, message: 'This reward is not available right now' },
  ALREADY_CLAIMED: { status: 409, message: 'You have already claimed this reward' },
  NOTHING_TO_CLAIM: { status: 409, message: 'There is nothing to claim yet — wager to earn this reward' },
  VIP_REQUIRED: { status: 403, message: 'Reach a higher VIP rank to unlock this reward' },
  PROGRAM_NOT_FOUND: { status: 404, message: 'No such reward' },
});
