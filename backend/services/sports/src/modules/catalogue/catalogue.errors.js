'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('CATALOGUE', {
  SPORT_NOT_FOUND: { status: 404, message: 'No such sport configuration' },

  SPORT_EXISTS: {
    status: 409,
    /**
     * Legacy's `addGame` was a bare INSERT with no conflict handling and no
     * unique constraint behind it, so the same `game_id` could be configured
     * twice — and the enabled-games filter then matched whichever row it read
     * first.
     */
    message: 'That sport is already configured',
  },

  FANCY_CONTROL_NOT_FOUND: { status: 404, message: 'No such fancy market control' },

  NOTHING_TO_UPDATE: {
    status: 422,
    // Legacy's `updateGame` built its SET clause from whichever fields were
    // present and, given none, produced `UPDATE sports_config SET  WHERE id=$1`
    // — a syntax error reported as a 500.
    message: 'Give at least one field to change',
  },
});
