'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('BRANCH', {
  DISABLED: { status: 403, message: 'Branch management is switched off on this site' },

  OWNER_ONLY: { status: 403, message: 'Only the Super Admin can manage branches' },

  NOT_FOUND: { status: 404, message: 'Branch not found' },

  USERNAME_TAKEN: { status: 409, message: 'That branch username is already in use' },

  PLAYER_EXISTS: { status: 409, message: 'That username or email is already in use' },

  PLAYER_NOT_FOUND: { status: 404, message: 'This player is not in the branch' },

  // One answer for a wrong username and a wrong password, like the staff sign-in.
  INVALID_CREDENTIALS: { status: 401, message: 'Wrong username or password' },

  INACTIVE: { status: 403, message: 'This branch is inactive. Contact the Super Admin.' },

  UNAUTHENTICATED: { status: 401, message: 'Sign in to the branch panel again' },

  NOTHING_TO_UPDATE: { status: 400, message: 'No changes were supplied' },
});
