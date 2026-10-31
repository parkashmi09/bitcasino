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

const referralCodeParam = {
  params: z.object({
    referralCode: z.string().trim().min(1).max(64),
  }),
};

module.exports = { updateProfile, referralCodeParam, username };
