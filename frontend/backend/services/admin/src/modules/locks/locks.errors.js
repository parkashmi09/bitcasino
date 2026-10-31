'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('LOCKS', {
  NOTHING_TO_UPDATE: { status: 400, message: 'No lock was named' },

  NO_TARGET: { status: 400, message: 'Name a player or an agent to lock' },

  AMBIGUOUS_TARGET: {
    status: 400,
    /**
     * Legacy took `if (user_id) … else if (staff_id && level == 0) …`, so
     * sending both silently locked only the player and the caller had no way to
     * know the agent branch was skipped.
     */
    message: 'Name either a player or an agent, not both',
  },

  NOT_IN_YOUR_TREE: {
    status: 404,
    /**
     * Also what a lock that MATCHED NO ROWS answers with. Legacy ignored the
     * row count and reported success either way.
     */
    message: 'No such account in your tree',
  },

  CANNOT_LOCK_SELF: {
    status: 422,
    message: 'You cannot lock your own account through this route',
  },

  UNKNOWN_REFERRAL: { status: 404, message: 'Unknown referral code' },
});
