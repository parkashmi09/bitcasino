'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('BET_ADMIN', {
  VISIBILITY_UNAVAILABLE: {
    status: 503,
    /**
     * Fail CLOSED. If the staff tree cannot be resolved, the alternative is
     * showing an unscoped report — which is what the legacy header-based
     * version did on every request anyway.
     */
    message: 'Could not determine which accounts you may report on',
  },

  USER_NOT_FOUND: { status: 404, message: 'Player not found' },

  NOT_IN_YOUR_TREE: {
    status: 404,
    // 404 rather than 403: confirming that an account exists but is outside
    // the caller's tree is itself information about the hierarchy.
    message: 'Player not found',
  },
});
