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

  /**
   * Inside the 24-hour window that follows a password change — migration 040.
   *
   * 403 and not 423: the account is not locked, this one action is refused for
   * a while, and 403 is what the KYC refusal beside it already uses for the
   * same shape of "you, but not yet". The message carries no time; the
   * `retryAfter` detail does, because a message that hardcodes "24 hours"
   * would be wrong the moment a player reads it 23 hours in.
   */
  WITHDRAW_COOLDOWN: {
    status: 403,
    message: 'Withdrawals are paused for 24 hours after a password change',
  },
});
