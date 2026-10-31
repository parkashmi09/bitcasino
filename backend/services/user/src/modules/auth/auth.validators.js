'use strict';

const { z } = require('@ibitplay/common');

// The display-name rules already live with the profile module; a name
// chosen at signup and a name chosen later must not be able to disagree.
const { username } = require('../profile/profile.validators');

/**
 * Auth request schemas.
 *
 * The password rule is length-first. Composition rules ("one uppercase, one
 * symbol") push people toward `Password1!` — predictable to an attacker and
 * hard for the person to remember — so the floor is 8 characters with no
 * character-class requirement, which is both stronger and kinder.
 */
const password = z
  .string({ required_error: 'password is required' })
  .min(8, 'password must be at least 8 characters')
  .max(200, 'password must be at most 200 characters');

/** Login accepts a username, an email or a phone number in one field. */
const identifier = z.string().trim().min(1, 'username or email is required').max(255);

const login = {
  body: z
    .object({
      identifier,
      password: z.string().min(1, 'password is required'),
      // Present only when the account has 2FA enabled.
      twoFactorCode: z.string().trim().regex(/^\d{6}$/, 'the code is 6 digits').optional(),
      deviceLabel: z.string().trim().max(100).optional(),
    })
    .strict(),
};

/**
 * Registration.
 *
 * The service method behind this has existed since the port; only the HTTP
 * route was missing, so the sole way to create an account was the socket
 * event `REGISTER_USER` — whose reply carries no tokens, leaving a client to
 * register and then immediately log in with the password it still had in
 * memory. One POST now does both.
 *
 * `referredBy` is somebody ELSE's referral code. It is not `referalcode`,
 * which is the column holding this account's own — the two are one letter
 * apart in the database and mean opposite things.
 */
const register = {
  body: z
    .object({
      username,
      password,
      // Optional because the platform allows phone-only accounts, and the
      // uniqueness constraint covers whichever is supplied.
      email: z.string().trim().toLowerCase().email('that is not a valid email address').max(160).optional(),
      phone: z.string().trim().max(30).optional(),
      country: z.string().trim().max(80).optional(),
      referredBy: z.string().trim().max(64).optional(),
    })
    .strict(),
};

const refresh = {
  body: z.object({ refreshToken: z.string().min(20, 'refreshToken is required') }).strict(),
};

const logout = {
  body: z
    .object({
      refreshToken: z.string().min(20).optional(),
      // "Sign out everywhere" after a suspected compromise.
      allSessions: z.boolean().default(false),
    })
    .strict(),
};

const changePassword = {
  body: z
    .object({
      currentPassword: z.string().min(1, 'currentPassword is required'),
      newPassword: password,
    })
    .strict()
    .refine((v) => v.currentPassword !== v.newPassword, {
      message: 'The new password must be different from the current one',
      path: ['newPassword'],
    }),
};

/**
 * Begin a password reset.
 *
 * Only an address, and the service answers identically whether or not it is
 * registered — so this schema must not become the thing that distinguishes
 * them. Keep it to a shape check: rejecting a malformed address is fine,
 * rejecting an unregistered one would undo the service's own care.
 */
const requestPasswordReset = {
  body: z
    .object({ email: z.string().trim().toLowerCase().email('a valid email is required').max(255) })
    .strict(),
};

/**
 * Finish a reset with the token from the email.
 *
 * `newPassword` takes the same floor as every other password here. No
 * `currentPassword` and no session: holding the token IS the proof, which is
 * why the token is single-use and short-lived in the service.
 */
const completePasswordReset = {
  body: z
    .object({
      token: z.string().trim().min(1, 'token is required').max(512),
      newPassword: password,
    })
    .strict(),
};

/** The session id is a bigint on the wire, so it arrives as a digit string. */
const revokeSession = {
  params: z.object({ sessionId: z.string().trim().regex(/^\d+$/, 'sessionId must be numeric') }),
};

/** The one-time code the Google callback handed the player site. */
const googleExchange = {
  body: z.object({ code: z.string().trim().min(16).max(128), nonce: z.string().regex(/^[A-Za-z0-9_-]{22,128}$/) }).strict(),
};

module.exports = {
  googleExchange,
  login,
  refresh,
  logout,
  changePassword,
  register,
  requestPasswordReset,
  completePasswordReset,
  revokeSession,
  password,
  identifier,
};
