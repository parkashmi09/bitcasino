'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('NOTIFICATIONS', {
  NOT_IN_YOUR_TREE: { status: 404, message: 'Player not found' },

  NO_DEVICES: {
    status: 422,
    // Sending to a player with no registered device is not an error worth a
    // 500, but it is worth saying — the operator expects it to arrive.
    message: 'That player has no registered device',
  },

  PUSH_NOT_CONFIGURED: {
    status: 501,
    /**
     * The Firebase credential is optional configuration. A deployment without
     * it still records notifications — they simply are not pushed — and this
     * says so rather than failing at boot or silently doing nothing.
     */
    message: 'Push delivery is not configured',
  },

  BROADCAST_TOO_LARGE: {
    status: 422,
    message: 'That broadcast would reach more devices than a single send allows',
  },
});
