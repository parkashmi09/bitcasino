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

  // Overdraw is the shared 422 INSUFFICIENT_FUNDS — see `lords/staffFloat.js`.

  CANNOT_TRANSFER_TO_SELF: { status: 422, message: 'An account cannot transfer to itself' },

  NOT_PERMITTED: { status: 403, message: 'Your role does not permit that' },

  /**
   * The hierarchy rule: an account is created, re-levelled or acted on only
   * strictly below the caller (and below its own parent). Legacy took the role
   * from the body unchecked, so an Admin could mint a Super Admin.
   */
  LEVEL_NOT_BELOW: { status: 403, message: 'You can only manage accounts below your own level' },

  UNKNOWN_ROLE: { status: 422, message: 'No such role' },

  PASSWORD_CHANGE_REQUIRED: {
    status: 403,
    message: 'Set a new password before doing anything else',
  },

  OLD_PASSWORD_WRONG: { status: 400, message: 'The current password is not correct' },

  // rainbet: below the Super Admin a password changes only at the forced change, or by an upline.
  OWN_PASSWORD_LOCKED: { status: 403, message: 'Your password can only be changed by an account above you' },
});
