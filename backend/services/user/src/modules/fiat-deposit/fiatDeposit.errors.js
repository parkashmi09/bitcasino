'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('FIAT_DEPOSIT', {
  NOT_FOUND: {
    status: 404,
    message: 'Deposit not found',
  },
  ALREADY_PROCESSED: {
    status: 409,
    message: 'This deposit has already been approved or rejected',
  },
  NETWORK_REQUIRED: {
    status: 422,
    message: 'Choose the network you sent the crypto on',
  },
  NETWORK_NOT_ENABLED: {
    status: 422,
    message: 'This network is not enabled for the coin',
  },
  SCREENSHOT_REQUIRED: {
    status: 422,
    message: 'Proof of payment is required',
  },
  INVALID_SCREENSHOT: {
    status: 422,
    message: 'Proof of payment must be a JPEG, PNG or PDF',
  },
  SCREENSHOT_TOO_LARGE: {
    status: 413,
    message: 'Proof of payment must be 5 MB or smaller',
  },
  SCREENSHOT_NOT_FOUND: {
    status: 404,
    message: 'No proof of payment was attached to this deposit',
  },
  DUPLICATE_TRANSACTION: {
    status: 409,
    // Two deposits claiming one bank reference is the commonest fraud attempt
    // on a manual-review flow.
    message: 'A deposit with this transaction reference already exists',
  },
  REJECTION_REASON_REQUIRED: {
    status: 422,
    message: 'A reason is required when rejecting a deposit',
  },
  /** Approving for more than the player asked to deposit — details `{ claimed, credit }`. */
  CREDIT_ABOVE_CLAIMED: {
    status: 422,
    message: 'The credited amount cannot be more than the amount the player deposited',
  },
  /** Approving for less than claimed needs the reason the player will see — details `{ claimed, credit }`. */
  CREDIT_REASON_REQUIRED: {
    status: 422,
    message: 'A reason is required when crediting less than the amount the player deposited',
  },
});
