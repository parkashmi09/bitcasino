'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('TWOFA', {
  ALREADY_ENABLED: {
    status: 409,
    message: 'Two-factor authentication is already enabled',
  },
  NOT_INITIATED: {
    status: 409,
    message: 'Start two-factor setup before verifying a code',
  },
  NOT_ENABLED: {
    status: 409,
    message: 'Two-factor authentication is not enabled on this account',
  },
  INVALID_CODE: {
    status: 401,
    message: 'That code is not correct',
  },
  PASSWORD_REQUIRED: {
    status: 401,
    // Disabling 2FA is a security downgrade. A hijacked session should not be
    // able to do it silently, so the account password is required.
    message: 'Your account password is required to disable two-factor authentication',
  },
});
