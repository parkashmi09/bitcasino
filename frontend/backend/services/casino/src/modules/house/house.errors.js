'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('HOUSE', {
  NO_SUCH_ROW: {
    status: 404,
    /**
     * From the ROW COUNT of the update. Legacy answered "House updated
     * successfully" whether or not the statement matched anything.
     */
    message: 'No house row for that player',
  },

  NO_TARGET: {
    status: 400,
    message: 'Name the players to change, or say `scope: "all"` explicitly',
  },
});
