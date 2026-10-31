'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('LOSS_BONUS', {
  DISABLED: { status: 403, message: 'Loss bonus is not available right now.' },
  NOT_ELIGIBLE: { status: 403, message: 'Your account is not eligible for the loss bonus.' },
  NOTHING_TO_CLAIM: { status: 409, message: 'There is no loss bonus to claim.' },
  ALREADY_CLAIMED: { status: 409, message: 'You have already claimed this loss bonus.' },
  NO_DEPOSIT: { status: 409, message: 'Make your first deposit to activate the loss bonus.' },
  NOT_SETTLED: { status: 409, message: 'Your loss bonus settles when the protection period ends.' },
  EXPIRED: { status: 409, message: 'The time to claim this loss bonus has passed.' },
});
