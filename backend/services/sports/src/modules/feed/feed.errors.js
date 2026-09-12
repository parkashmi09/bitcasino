'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('FEED', {
  GAME_NOT_FOUND: {
    status: 404,
    message: 'No data for that sport right now',
  },

  INVALID_DATE_RANGE: {
    status: 422,
    /**
     * Legacy's `getRange` returned `null` for an unrecognised value and the
     * caller read `null` as "no filter", so `/matches-by-date/yesterday`
     * answered 200 with the entire board.
     */
    message: 'That is not a date range this endpoint understands',
  },

  PROVIDER_NOT_CONFIGURED: {
    status: 501,
    /**
     * The second and third providers are optional configuration. Saying so is
     * better than a crash at boot for a deployment that only uses the odds
     * feed, and better than a 500 that looks like an outage.
     */
    message: 'This feature needs a sports data provider that is not configured',
  },

  UPSTREAM_ERROR: { status: 502, message: 'The sports data provider rejected the request' },
  UNREACHABLE: { status: 504, message: 'The sports data provider did not respond' },
});
