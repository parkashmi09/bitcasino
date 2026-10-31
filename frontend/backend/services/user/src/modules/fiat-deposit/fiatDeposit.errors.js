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
});
