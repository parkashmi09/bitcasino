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
  /** A demo account's time is up (`users.demo_expires_at`); it is deleted soon after. */
  DEMO_DISABLED: {
    status: 403,
    message: 'Demo accounts are not available on this site',
  },
  DEMO_UNAVAILABLE: {
    status: 503,
    message: 'A demo account could not be created right now. Try again.',
  },
  DEMO_EXPIRED: {
    status: 401,
    message: 'Your demo session has ended. Start a new demo or use a real ID.',
  },
  TOO_MANY_ATTEMPTS: {
    status: 429,
    message: 'Too many failed sign-in attempts. Try again later.',
  },

  /**
   * The signup form named a referrer that does not exist. Refused rather than
   * ignored: the player believes they joined someone's team, and the referrer
   * believes they will be paid for it. An EMPTY code is fine — that is "no
   * referrer", not a wrong one.
   */
  REFERRAL_CODE_INVALID: {
    status: 422,
    message: 'That referral code does not match any player. Check it, or leave it empty.',
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
  OWN_PASSWORD_LOCKED: { status: 403, message: 'Your password can only be changed by your upline' },

  CURRENT_PASSWORD_INCORRECT: {
    /**
     * 403, NOT 401, AND THE DIFFERENCE IS NOT COSMETIC.
     *
     * This is raised inside an ALREADY-AUTHENTICATED request: the caller's
     * access token was perfectly good, and what failed was a credential check
     * the endpoint makes on top of it. A 401 says "your token is no good",
     * which is false here and which clients act on — a browser that reads 401
     * as "the access token expired" will refresh the session and REPLAY the
     * request, so every wrong password reaches this server twice and rotates a
     * refresh token on the way. Any counter built on these attempts — a lockout
     * after N tries, a rate limit, an audit trail — then counts double.
     *
     * The two-factor errors above stay 401 on purpose: they are raised during
     * LOGIN, where there is no session yet and a failed factor really is an
     * authentication failure.
     */
    status: 403,
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

  /** Google sign-in is switched off: its keys are not set. */
  GOOGLE_NOT_CONFIGURED: { status: 503, message: 'Sign in with Google is not available' },
  /** The owner's `google_signin` policy is off (owner panel → Features & plan). */
  GOOGLE_DISABLED: { status: 403, message: 'Sign in with Google is switched off' },
  /** Google proved the email, but a password account already holds it. Never linked automatically:
   *  this platform does not verify emails, so the existing account may not belong to this person. */
  GOOGLE_EMAIL_IN_USE: { status: 409, message: 'An account with this email already exists. Sign in with your password.' },
  GOOGLE_SIGNIN_FAILED: { status: 401, message: 'Google sign-in did not complete. Try again.' },
  /** One code for missing, used and expired — same reasoning as the reset link. */
  GOOGLE_CODE_INVALID: { status: 401, message: 'That sign-in link is not valid or has expired' },
  GOOGLE_TWO_FACTOR_ON: {
    status: 403,
    message: 'Two-factor authentication is on for this account. Sign in with your username, password and code.',
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

  /**
   * The device a player asked to sign out is not one of theirs, or is already
   * gone. 404 AND NOT 401, deliberately: the caller's own token was perfectly
   * good, and 401 is what this project's transport reads as "your access token
   * expired" — it would refresh the session and replay the delete, which is
   * gaps 22 and 22b again on a third endpoint. `SESSION_NOT_FOUND` above is
   * the 401 that means the CALLER's session is dead; this is a different
   * event and needed its own name rather than a reused one.
   *
   * Same answer for "not yours" as for "does not exist", so session ids
   * cannot be probed from another account.
   */
  DEVICE_NOT_FOUND: {
    status: 404,
    message: 'That device is not signed in',
  },

  REGISTRATION_FAILED: {
    status: 500,
    // Only after the id or referral-code allocator has exhausted its retries,
    // which means something is wrong with the generator rather than with luck.
    message: 'That account could not be created',
  },
});
