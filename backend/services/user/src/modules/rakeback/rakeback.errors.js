'use strict';

const { defineErrors } = require('@ibitplay/common');

const { MIN_CLAIM, RAKEBACK_CURRENCY } = require('./rakeback.constants');

/**
 * Legacy had no error path at all on the read:
 *
 *     if (!err) { ... callback({amount: _rakeback}); }
 *     else { console.log("err -166", err); /* callback(null) is COMMENTED OUT *\/ }
 *
 * On a database error the callback was never invoked, so the socket handler
 * never emitted and the client waited forever with a spinner.
 */
module.exports = defineErrors('RAKEBACK', {
  NOTHING_TO_CLAIM: {
    status: 409,
    message: `There is less than ${MIN_CLAIM} ${RAKEBACK_CURRENCY} of rakeback to claim`,
  },

  USER_NOT_FOUND: {
    status: 404,
    /**
     * `res.rows[0].rakeamount` on an id that does not exist throws
     * `TypeError: Cannot read properties of undefined` inside a pg callback —
     * an unhandled rejection, which under legacy's setup takes the process out.
     */
    message: 'Player not found',
  },

  CLAIM_IN_PROGRESS: {
    status: 409,
    // The guarded UPDATE is the real defence; this is what losing that race
    // reads like to a client that double-clicked.
    message: 'A rakeback claim is already being processed',
  },
});
