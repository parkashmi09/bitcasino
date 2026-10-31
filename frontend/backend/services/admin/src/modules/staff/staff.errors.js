'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('STAFF', {
  NOT_FOUND: { status: 404, message: 'Staff account not found' },

  NOT_IN_YOUR_TREE: {
    status: 404,
    // 404 rather than 403: confirming an account exists but is outside the
    // caller's tree is itself information about the hierarchy.
    message: 'Staff account not found',
  },

  PLAYER_NOT_IN_YOUR_TREE: { status: 404, message: 'Player not found' },

  INSUFFICIENT_FUNDS: {
    status: 402,
    /**
     * Decided by the guarded UPDATE, not by a JavaScript comparison a
     * concurrent request could invalidate. Legacy read the balance without a
     * lock and then debited unconditionally.
     */
    message: 'There is not enough in that balance to cover this transfer',
  },

  CANNOT_TRANSFER_TO_SELF: { status: 422, message: 'An account cannot transfer to itself' },

  CANNOT_DELETE_WITH_DESCENDANTS: {
    status: 409,
    // Legacy deleted the row and left the subtree pointing at nothing.
    message: 'This account still has accounts beneath it',
  },

  CANNOT_DELETE_WITH_BALANCE: {
    status: 409,
    message: 'This account still holds a balance — move it first',
  },

  NOT_PERMITTED: { status: 403, message: 'Your role does not permit that' },

  OLD_PASSWORD_WRONG: { status: 400, message: 'The current password is not correct' },
});
