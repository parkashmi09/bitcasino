'use strict';

const { z } = require('@ibitplay/common');

const email = z.string().trim().toLowerCase().email().max(255);
const username = z.string().trim().toLowerCase().min(3).max(100);

/**
 * A submitted password.
 *
 * Bounded above so a multi-megabyte string cannot be handed to bcrypt — the
 * cost is proportional to the input and an unbounded one is a CPU lever on an
 * unauthenticated endpoint. Not bounded BELOW: a short password is a failed
 * sign-in, not a validation error, and refusing it early tells the caller
 * something about the account.
 */
const submitted = z.string().min(1).max(200);

/** A NEW password. Length only — composition rules push people towards `Passw0rd!`. */
const chosen = z.string().min(12, 'must be at least 12 characters').max(200);

/**
 * A TOTP code.
 *
 * Exactly six digits, as a string. A `z.number()` would accept `012345` as
 * `12345` and drop the leading zero — which is one in ten codes silently
 * failing, and the kind of bug that gets blamed on the authenticator app.
 *
 * Optional on the login bodies: whether it is REQUIRED depends on the account,
 * and that is not knowable until the password has been checked. Demanding it
 * in the schema would answer "does this account have 2FA" to anyone who
 * posted an email, which is precisely the enumeration oracle the rest of this
 * module is built to avoid.
 */
const twoFactorCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'must be the 6-digit code from your authenticator app');

const login = {
  body: z.object({ email, password: submitted, twoFactorCode: twoFactorCode.optional() }).strict(),
};

const executiveLogin = {
  body: z.object({ username, password: submitted, twoFactorCode: twoFactorCode.optional() }).strict(),
};

/** Enrolment: begin, confirm, and turn off. */
const beginTwoFactor = { body: z.object({}).strict().optional() };

const confirmTwoFactor = { body: z.object({ code: twoFactorCode }).strict() };

/**
 * Turning 2FA off requires the password AS WELL AS a current code.
 *
 * A stolen session alone must not be able to strip the second factor — that
 * would make it removable by exactly the attack it exists to survive. The
 * player flow already works this way; this matches it.
 */
const disableTwoFactor = {
  body: z.object({ code: twoFactorCode, password: submitted }).strict(),
};

/**
 * Setting a password on first sign-in.
 *
 * The CURRENT one is required, so this is a change rather than a reset. Legacy
 * relied on the `first_login` flag alone, which means an account still carrying
 * it could have its password replaced by whoever reached the endpoint.
 */
const firstLoginPassword = {
  body: z
    .object({ email, currentPassword: submitted, newPassword: chosen })
    .strict()
    .refine((v) => v.currentPassword !== v.newPassword, {
      message: 'the new password must be different',
      path: ['newPassword'],
    }),
};

module.exports = {
  login,
  executiveLogin,
  firstLoginPassword,
  beginTwoFactor,
  confirmTwoFactor,
  disableTwoFactor,
};
