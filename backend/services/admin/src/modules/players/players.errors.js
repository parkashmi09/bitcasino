'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('PLAYERS', {
  NOT_FOUND: { status: 404, message: 'Player not found' },

  ALREADY_EXISTS: { status: 409, message: 'That username or email is already in use' },

  NOT_PERMITTED: { status: 403, message: 'You may not do that' },

  // Overdraw is the shared 422 INSUFFICIENT_FUNDS — see `lords/staffFloat.js`.

  ALREADY_CLOSED: { status: 409, message: 'That account is already closed' },

  NOTHING_TO_UPDATE: { status: 400, message: 'No changes were supplied' },

  CANNOT_REPARENT_OUTSIDE_TREE: {
    status: 403,
    /**
     * Legacy accepted `parent_id` from the body and wrote it with no check at
     * all, so an agent could move any player they could see to ANY staff id —
     * including one above them, or one belonging to a rival.
     */
    message: 'A player may only be moved to an account inside your own tree',
  },
});
