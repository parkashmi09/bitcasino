'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('PAYORDER', {
  UNKNOWN_PROVIDER: { status: 404, message: 'Unknown payment provider' },
  PROVIDER_DISABLED: { status: 503, message: 'This payment provider is currently unavailable' },
  CURRENCY_NOT_SUPPORTED: {
    status: 422,
    message: 'This provider does not support that currency',
  },
  METHOD_NOT_SUPPORTED: { status: 422, message: 'That payment method is not available' },

  BELOW_MINIMUM: { status: 422, message: 'The amount is below the minimum for this provider' },
  ABOVE_MAXIMUM: { status: 422, message: 'The amount is above the maximum for this provider' },
  INSUFFICIENT_BALANCE: { status: 402, message: 'Insufficient balance for this withdrawal' },

  INVALID_PAYOUT_DETAILS: {
    status: 422,
    // The provider validates these too, but rejecting here happens BEFORE the
    // balance is held — a malformed IFSC should not tie up a player's money
    // while a round trip to the gateway fails.
    message: 'The payout details are not valid for this payment method',
  },

  ORDER_NOT_FOUND: { status: 404, message: 'Payment order not found' },

  PROVIDER_REJECTED: { status: 502, message: 'The payment provider rejected the request' },
  PROVIDER_UNREACHABLE: { status: 504, message: 'The payment provider did not respond' },

  KYC_REQUIRED: {
    status: 403,
    message: 'Identity verification is required before withdrawing',
  },

  WITHDRAWALS_DISABLED: {
    status: 503,
    message: 'Automatic withdrawals are currently disabled',
  },
});
