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
    /**
     * 403, NOT 401 — the same argument as `CURRENT_PASSWORD_INCORRECT` in the
     * auth module, and worth repeating because this is the family it was found
     * on second.
     *
     * Every throw site for this is inside an authenticated request:
     * `completeSetup`, `verify` and `disable`. The bearer token was valid; a
     * second factor supplied WITHIN that request was not. A client that reads
     * 401 as "the access token expired" refreshes and replays, so a mistyped
     * six digits hits the server twice and rotates a refresh token.
     *
     * `auth.errors.TWO_FACTOR_INVALID` is the login-time version and stays 401,
     * because there the factor IS the authentication.
     */
    status: 403,
    message: 'That code is not correct',
  },
  PASSWORD_REQUIRED: {
    // Disabling 2FA is a security downgrade. A hijacked session should not be
    // able to do it silently, so the account password is required.
    //
    // 403 for the reason above: this is a refusal inside an authenticated
    // request, not a statement that the token is bad.
    status: 403,
    message: 'Your account password is required to disable two-factor authentication',
  },
});
