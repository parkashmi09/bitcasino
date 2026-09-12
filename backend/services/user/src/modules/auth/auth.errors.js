'use strict';

const { defineErrors } = require('@ibitplay/common');

/**
 * Authentication failures.
 *
 * `INVALID_CREDENTIALS` deliberately covers "no such user" AND "wrong
 * password". Distinguishing them turns the login form into a user-enumeration
 * oracle: an attacker learns which addresses are registered by reading the
 * error, then targets only those. Legacy returned "User not found" and
 * "Incorrect password" separately.
 */
module.exports = defineErrors('AUTH', {
  INVALID_CREDENTIALS: {
    status: 401,
    message: 'Invalid username or password',
  },
  ACCOUNT_LOCKED: {
    status: 403,
    message: 'This account is locked. Contact support.',
  },
  ACCOUNT_INACTIVE: {
    status: 403,
    message: 'This account is not active',
  },
  TOO_MANY_ATTEMPTS: {
    status: 429,
    message: 'Too many failed sign-in attempts. Try again later.',
  },

  // ── Sessions ────────────────────────────────────────────────────────
  SESSION_NOT_FOUND: {
    status: 401,
    message: 'Session has expired. Please sign in again.',
  },
  SESSION_REVOKED: {
    status: 401,
    message: 'This session was signed out',
  },
  REFRESH_TOKEN_REUSED: {
    status: 401,
    // Reuse of a rotated refresh token means the token was captured. Every
    // session in the chain is revoked, so the message is about what happened.
    message: 'This session has been ended for security reasons. Please sign in again.',
  },

  // ── 2FA ─────────────────────────────────────────────────────────────
  TWO_FACTOR_REQUIRED: {
    status: 401,
    message: 'A two-factor code is required',
  },
  TWO_FACTOR_INVALID: {
    status: 401,
    message: 'The two-factor code is incorrect',
  },

  // ── Password ────────────────────────────────────────────────────────
  CURRENT_PASSWORD_INCORRECT: {
    status: 401,
    message: 'Your current password is incorrect',
  },
  PASSWORD_REUSED: {
    status: 422,
    message: 'The new password must be different from the current one',
  },

  PROVIDER_NOT_AVAILABLE: {
    status: 501,
    /**
     * Google sign-in. `Rule.loginByGoogle(username, email, token, …)` chose
     * the account from the `email` PARAMETER in the message, and whether that
     * is ever checked against the `token` beside it is not settled. Shipping a
     * guess at a federated-identity flow risks "anyone can sign in as anyone
     * with a Google button"; refusing clearly does not.
     */
    message: 'That sign-in method is not available',
  },

  RESET_TOKEN_INVALID: {
    status: 400,
    /**
     * One code for missing, already-used and expired. A caller learns the link
     * does not work, not which of the three — otherwise the endpoint tells an
     * attacker whether a token they hold was ever real.
     */
    message: 'That reset link is not valid or has expired',
  },

  ALREADY_REGISTERED: {
    status: 409,
    /**
     * Reports WHICH field collided. That is deliberate and it is a trade: a
     * signup form that cannot say "that username is taken" is unusable, and
     * both values were just supplied by the caller. It is not the same as the
     * LOGIN endpoint distinguishing a missing user from a wrong password,
     * which reveals something the caller did not already know.
     */
    message: 'That username or email is already registered',
  },

  REGISTRATION_FAILED: {
    status: 500,
    // Only after the id or referral-code allocator has exhausted its retries,
    // which means something is wrong with the generator rather than with luck.
    message: 'That account could not be created',
  },
});
