'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('CRYPTO', {
  BAD_SIGNATURE: {
    status: 401,
    message: 'Signature verification failed',
  },

  UNSUPPORTED_COIN: {
    status: 422,
    /**
     * A symbol that is not in `COIN_COLUMNS`. Legacy interpolated whatever
     * arrived straight into the `SET` clause of the credits UPDATE.
     */
    message: 'That coin is not one this platform holds',
  },

  PROVIDER_ERROR: { status: 502, message: 'The payment provider rejected the request' },

  /**
   * CCPayment is not set up in this deployment.
   *
   * 503, and named — not the 500 these routes used to answer. Without
   * `CCPAYMENT_BASE_URL` the client built the string
   * `undefined/ccpayment/v2/getChainList` and threw `Invalid URL`, which
   * reached the player as "Something went wrong" and told an operator
   * nothing about which setting was missing.
   *
   * Same shape as CATALOGUE_NOT_CONFIGURED and SPORTSBOOK_NOT_CONFIGURED:
   * an unconfigured integration is a deployment fact, not a server fault.
   */
  NOT_CONFIGURED: { status: 503, message: 'The crypto payment provider is not configured' },
  PROVIDER_DISABLED: {
    /**
     * 503, matching `payment-orders`' error of the same name and the game
     * providers' `*_NOT_CONFIGURED`, because it is the same situation: the
     * integration exists and this deployment has not been given credentials.
     *
     * WITHOUT IT `/user/crypto/chains` AND `/user/crypto/coins` ANSWERED 500.
     * `#ccpayment` reached straight for `this.http.raw(...)`, and `http` is not
     * injected when no provider is configured, so the reader got
     * `TypeError: Cannot read properties of undefined (reading 'raw')` — a
     * crash where every other provider in the platform refuses politely and by
     * name. `docs/backend-gaps.md` Part 5.2 is this.
     */
    status: 503,
    message: 'The crypto payment provider is not configured',
  },

  PLAYER_NOT_FOUND: {
    status: 404,
    /**
     * For the staff-entered INR deposit record. Legacy's `/hr` took a `uid`
     * from the body, never looked it up, and INSERTed regardless — so a
     * fabricated row could name an account that does not exist.
     */
    message: 'Player not found',
  },
});
