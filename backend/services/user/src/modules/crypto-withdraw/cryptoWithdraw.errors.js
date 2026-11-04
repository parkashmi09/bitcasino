'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('CRYPTO_WITHDRAW', {
  NOT_FOUND: { status: 404, message: 'Withdrawal not found' },
  // CCPayment pays to a network; a request without one is paid by hand.
  NEEDS_NETWORK: { status: 422, message: 'This withdrawal has no network, so it cannot be sent through CCPayment — pay it by hand' },
  NOT_SENDING: { status: 409, message: 'This withdrawal is not waiting on CCPayment' },

  INVALID_TRANSITION: {
    status: 409,
    /**
     * Legacy had no state machine: `UPDATE withdrawals SET status = $1` from
     * any state to any string. A withdrawal already marked done could be set
     * back to pending and approved again — and approval is the instruction to
     * send coin, so that is a second payout of the same request.
     */
    message: 'This withdrawal cannot move to that status from where it is',
  },

  TERMINAL: {
    status: 409,
    message: 'This withdrawal has already been settled and cannot be changed',
  },

  UNSUPPORTED_COIN: {
    status: 422,
    // A map picks the wallet column; legacy interpolated `_.lowerCase(coin)`.
    message: 'That currency cannot be withdrawn',
  },

  INVALID_AMOUNT: { status: 422, message: 'That amount is not valid' },

  /** The named network is not one this coin is offered on now (coin registry, migration 061). */
  NETWORK_UNAVAILABLE: { status: 422, message: 'That network is not available for this coin' },

  INVALID_ADDRESS: {
    status: 422,
    /**
     * Legacy's address check is commented out:
     *
     *     // if (wallet.length < 10) {
     *     //   return callback({ status: "Please enter valid wallet address." });
     *
     * so an empty destination was accepted. Only presence is checked here —
     * validating a chain address properly needs per-chain rules this port has
     * no reference for, and a wrong guess rejects real withdrawals.
     */
    message: 'Enter a wallet address'
  },

  PLAYER_NOT_FOUND: { status: 404, message: 'Player not found' },

  PASSWORD_INCORRECT: { status: 401, message: 'Your password is wrong' },

  ACCOUNT_LOCKED: {
    status: 403,
    // Legacy checked nothing here, so a lock applied because money was going
    // missing did not stop the payout.
    message: 'That account cannot withdraw'
  },

  /**
   * Inside the 24-hour window that follows a password change — migration 040.
   * The fiat rail's twin; both rails have to refuse or the freeze is only a
   * freeze on one of them, which is the class of disagreement Part 4b.5 and
   * 4b.6 already had to fix twice on these two.
   */
  WITHDRAW_COOLDOWN: {
    status: 403,
    message: 'Withdrawals are paused for 24 hours after a password change'
  },

  /** The fiat rail's twin: the same `WITHDRAW_MINIMUM`, the same refusal. */
  BELOW_MINIMUM: { status: 422, message: 'The amount is below the minimum withdrawal' },

  /** The fiat rail's twin: the `withdrawal_requirements` policy (and WITHDRAW_REQUIRE_KYC) gate both rails, or neither. */
  KYC_REQUIRED: { status: 403, message: 'Verify your identity before withdrawing' },

  INSUFFICIENT_BALANCE: {
    status: 422,
    // From the ROW COUNT of the guarded debit, not a read taken beforehand.
    message: 'Your credit is not enough'
  },
});
