'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('FIAT_WITHDRAW', {
  NOT_FOUND: {
    status: 404,
    message: 'Withdrawal request not found',
  },
  ALREADY_PROCESSED: {
    status: 409,
    message: 'This withdrawal has already been processed',
  },
  INSUFFICIENT_BALANCE: {
    status: 402,
    message: 'Insufficient balance for this withdrawal',
  },
  BANK_DETAILS_REQUIRED: {
    status: 422,
    message: 'Bank details are required for this currency',
  },
  UPI_OR_IFSC_REQUIRED: {
    status: 422,
    message: 'For INR withdrawals, either an IFSC code or a UPI id is required',
  },
  BELOW_MINIMUM: {
    status: 422,
    message: 'The amount is below the minimum withdrawal',
  },
  KYC_REQUIRED: {
    status: 403,
    // A gambling platform cannot pay out to an unverified account. Legacy did
    // not check, so withdrawals could be made before any identity check.
    message: 'Identity verification must be completed before withdrawing',
  },
});
