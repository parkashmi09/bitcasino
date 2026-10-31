'use strict';

const { z } = require('@ibitplay/common');

/**
 * Usernames are displayed to other players in chat and on leaderboards, so the
 * character set is restricted. Legacy accepted any string of any length,
 * including one that renders as markup.
 */
const username = z
  .string({ required_error: 'username is required' })
  .trim()
  .min(3, 'username must be at least 3 characters')
  .max(30, 'username must be at most 30 characters')
  .regex(/^[A-Za-z0-9_.-]+$/, 'username may contain letters, digits and _ . - only');

/** `POST /profile/avatar` — an id from `GET /admin/avatars/public`. */
const setAvatar = {
  body: z.object({ avatarId: z.coerce.number().int().positive() }).strict(),
};

const updateProfile = {
  body: z
    .object({
      username: username.optional(),
      country: z.string().trim().max(100).optional(),
      avatar: z.string().trim().max(500).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }),
};

/**
 * Change the address password reset delivers to.
 *
 * `code` is required rather than optional, which is the one place this differs
 * from the socket handler: `EDIT_ACCOUNT` verified a code only `if (code !==
 * undefined)` and still called `changeEmail`, leaning on `proveEmail` to refuse
 * when no proof had been spent. That works, but it makes "no code supplied"
 * and "wrong code" two different paths to the same refusal. A dedicated route
 * can simply require it.
 */
const changeEmail = {
  body: z
    .object({
      email: z.string().trim().toLowerCase().email('a valid email is required').max(255),
      code: z.string().trim().regex(/^\d{6}$/, 'the code is 6 digits'),
    })
    .strict(),
};

/** A player id is a bigint on the wire. */
const userIdParam = {
  params: z.object({ userId: z.string().trim().regex(/^\d+$/, 'userId must be numeric') }),
};

const referralCodeParam = {
  params: z.object({
    referralCode: z.string().trim().min(1).max(64),
  }),
};

/** `GET /profile/turnover?currency=INR`: the display currency (the site's "View in"); optional. */
const turnoverQuery = {
  query: z
    .object({
      currency: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, 'currency must be a currency code').optional(),
    })
    .strict(),
};

module.exports = { setAvatar, updateProfile, changeEmail, referralCodeParam, userIdParam, username, turnoverQuery };
