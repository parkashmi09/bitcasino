'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('STAFF_AUTH', {
  INVALID_CREDENTIALS: {
    status: 401,
    /**
     * ONE answer for "no such account" and "wrong password".
     *
     * Legacy sent 'Bad email' and 'Bad password' — two distinguishable
     * responses, so the endpoint enumerated staff accounts for anyone who
     * wanted a list.
     */
    message: 'Those credentials are not valid',
  },

  ACCOUNT_UNAVAILABLE: {
    status: 403,
    // Deliberately vague, and only reachable AFTER the password is proven —
    // otherwise it becomes the enumeration oracle the message above avoids.
    message: 'This account cannot sign in. Contact your upline.',
  },

  TOO_MANY_ATTEMPTS: {
    status: 429,
    // Legacy had no limit of any kind on an endpoint guarding accounts that
    // move money.
    message: 'Too many sign-in attempts. Try again shortly.',
  },

  PASSWORD_CHANGE_REQUIRED: {
    status: 403,
    message: 'You must set a new password before continuing',
  },

  /**
   * The password was right and this account has a second factor.
   *
   * A distinct code from INVALID_CREDENTIALS because the client has to act
   * differently — show the code field, keep what was typed — and because this
   * is only ever reached AFTER the password is proven. It therefore says
   * nothing to someone who has not already got the password right, which is
   * what keeps it from becoming an account-enumeration oracle.
   */
  TWO_FACTOR_REQUIRED: {
    status: 401,
    message: 'Enter the 6-digit code from your authenticator app',
  },

  /**
   * ONE answer for "wrong code" and "that code was already used".
   *
   * A separate message for a replay would confirm to whoever captured the code
   * that it was genuine and merely late. The distinction is logged, where it
   * is useful, and not returned, where it is not.
   */
  TWO_FACTOR_INVALID: {
    status: 401,
    message: 'That code is not valid. Check your authenticator app and try again.',
  },

  /**
   * The account's role requires a second factor and it has none.
   *
   * 403 rather than 401: the credentials were accepted, the account is simply
   * not allowed a session in this state. The message names the next step,
   * because the operator cannot resolve it by trying again.
   */
  TWO_FACTOR_ENROLMENT_REQUIRED: {
    status: 403,
    message:
      'Your role requires two-factor authentication. Ask an administrator to start enrolment for your account.',
  },

  TWO_FACTOR_ALREADY_ENABLED: {
    status: 409,
    message: 'Two-factor authentication is already enabled on this account',
  },

  TWO_FACTOR_NOT_INITIATED: {
    status: 409,
    message: 'Start two-factor setup before verifying a code',
  },

  TWO_FACTOR_NOT_ENABLED: {
    status: 409,
    message: 'Two-factor authentication is not enabled on this account',
  },
});
