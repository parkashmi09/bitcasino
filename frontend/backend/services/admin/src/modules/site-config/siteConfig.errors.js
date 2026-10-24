'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('SITE_CONFIG', {
  NOT_CONFIGURED: {
    status: 409,
    /**
     * Legacy's UPDATE had no WHERE clause, so against an empty `siteconfig` it
     * matched zero rows, read `rows[0]` of nothing, and answered
     * "Settings updated successfully" with `data: undefined`. A write that
     * changed nothing reported success.
     */
    message: 'There is no site configuration row to update',
  },

  NO_ALERT_INBOX: {
    status: 422,
    message: 'Set a notification email address before sending a test',
  },

  /**
   * The body named nothing this endpoint is willing to write.
   *
   * Distinct from "nothing to change": the caller may well have sent fields,
   * and every one of them was outside the allow-list. Saying so is the point —
   * legacy would have written them.
   */
  NOTHING_TO_UPDATE: {
    status: 400,
    message: 'Give at least one setting this endpoint can change',
  },

  PLAYER_NOT_IN_YOUR_TREE: {
    status: 403,
    message: 'That player is not in your tree',
  },
});
