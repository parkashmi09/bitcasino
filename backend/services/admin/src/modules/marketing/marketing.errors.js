'use strict';

const { defineErrors } = require('@ibitplay/common');
const { MAX_RANGE_DAYS } = require('./marketing.constants');

module.exports = defineErrors('MARKETING', {
  /**
   * The panel is read-only, structurally.
   *
   * Legacy answered 405 to any verb but GET before a handler ran, with an
   * explicit comment that the UI hiding the buttons is not the guarantee. Kept.
   */
  READ_ONLY: { status: 405, message: 'The marketing panel is read-only' },

  ACCOUNT_REQUIRED: {
    status: 403,
    /**
     * A plain staff token, or a classic executive one, must not reach
     * platform-wide revenue figures by knowing the URL. The `kind` is re-read
     * from the database rather than trusted from a JWT claim.
     */
    message: 'A marketing account is required',
  },

  ACCOUNT_INACTIVE: { status: 403, message: 'That account is not active' },

  BAD_RANGE: { status: 400, message: '`from` must be before `to`' },

  RANGE_TOO_LARGE: { status: 400, message: `A range may cover at most ${MAX_RANGE_DAYS} days` },

  NO_EXCHANGE_RATES: {
    status: 503,
    // Every figure on this panel is a USD conversion. With no rates the answer
    // is not zero, it is unavailable.
    message: 'Exchange rates are unavailable, so deposit volume cannot be computed',
  },
});
