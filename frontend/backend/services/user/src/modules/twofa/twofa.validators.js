'use strict';

const { z } = require('@ibitplay/common');

const code = z
  .string({ required_error: 'code is required' })
  .trim()
  .regex(/^\d{6}$/, 'the code is 6 digits');

/**
 * Note what is NOT here: `uid`.
 *
 * Every legacy 2FA endpoint took the user id from the request body or path and
 * had no authentication, so `POST /2fa/disable {"uid": 123}` turned off any
 * player's second factor. The id now comes from the verified token only.
 */
const verifyCode = { body: z.object({ code }).strict() };

const disable = {
  body: z.object({ code, password: z.string().min(1, 'password is required') }).strict(),
};

module.exports = { verifyCode, disable, code };
