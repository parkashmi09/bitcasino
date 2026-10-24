'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('WAGER', {
  USER_NOT_FOUND: { status: 404, message: 'Account not found' },
  MULTIPLIER_LOCKED: {
    status: 409,
    // A locked multiplier is a per-player agreement. A bulk update must not
    // silently override it — legacy's own comment flagged this as a critical fix.
    message: 'This account has a locked wagering multiplier and was not changed',
  },
  INVALID_MULTIPLIER: { status: 422, message: 'The multiplier must be between 0 and 100' },
});
