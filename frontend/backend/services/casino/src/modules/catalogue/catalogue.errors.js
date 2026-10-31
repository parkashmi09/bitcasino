'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('CATALOGUE', {
  NOT_CONFIGURED: {
    status: 503,
    /**
     * There is deliberately no fallback for any upstream credential. Legacy
     * hardcoded `agent_code: "Skyla_USD"` and its token in three handlers; a
     * default here would mean a deployment that looks configured and is
     * playing through somebody else's aggregator account.
     */
    message: 'The casino catalogue is not configured',
  },

  UNKNOWN_UPSTREAM: { status: 500, message: 'Unknown catalogue upstream' },

  UPSTREAM_REFUSED: {
    status: 502,
    /**
     * Says only that the provider refused. Legacy forwarded the aggregator's
     * own error text AND its status code straight through — and those errors
     * quote the request back, request including the agent token.
     */
    message: 'The game provider refused that request',
  },

  GAME_NOT_FOUND: { status: 404, message: 'No such game' },

  PLAYER_LOCKED: { status: 403, message: 'That account cannot play casino games' },
});
