'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('ACCESS', {
  NOT_FOUND: { status: 404, message: 'Account not found' },

  NOT_YOURS: {
    status: 404,
    // 404 rather than 403 — confirming an executive exists but belongs to
    // another staff member is information about the hierarchy.
    message: 'Account not found',
  },

  USERNAME_TAKEN: { status: 409, message: 'That username is already in use' },

  PERMISSION_ESCALATION: {
    status: 403,
    /**
     * The one this module exists for. Legacy validated the permission payload's
     * SHAPE and never compared it to the creator's own authority, so a staff
     * member could mint an executive more powerful than themselves.
     */
    message: 'You cannot grant a permission you do not hold yourself',
  },

  NOT_PERMITTED: { status: 403, message: 'Your role does not permit that' },

  TRANSACTION_PASSWORD_REQUIRED: {
    status: 403,
    message: 'This action requires your transaction password',
  },
});
