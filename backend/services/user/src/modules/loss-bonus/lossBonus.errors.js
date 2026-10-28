'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('LOSS_BONUS', {
  DISABLED: { status: 403, message: 'Loss bonus is not available right now.' },
  NOT_ELIGIBLE: { status: 403, message: 'Your account is not eligible for the loss bonus.' },
  NOTHING_TO_CLAIM: { status: 409, message: 'There is no loss bonus to claim for the last period.' },
  ALREADY_CLAIMED: { status: 409, message: 'You have already claimed the loss bonus for this period.' },
});
