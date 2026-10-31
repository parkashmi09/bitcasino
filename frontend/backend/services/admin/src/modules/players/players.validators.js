'use strict';

const { z } = require('@ibitplay/common');

/**
 * Money as a decimal STRING, never a number.
 *
 * `initial_balance` came off the body unvalidated in legacy and was compared
 * with `>` against a balance — so a string, a negative, or a float all reached
 * the transfer.
 */
const amount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, 'An amount must be a positive decimal string')
  .default('0');

const username = z.string().trim().min(3).max(60);
const password = z.string().min(8).max(200);
const playerId = z.coerce.number().int().positive();

module.exports = {
  /** @legacy POST /api/staff/players */
  create: {
    body: z
      .object({
        username,
        email: z.string().trim().email().max(160).optional(),
        phone: z.string().trim().max(30).optional(),
        country: z.string().trim().max(80).optional(),
        password,
        initialBalance: amount,
        /** Anchor the player under a sub-agent rather than the caller. */
        parentId: z.coerce.number().int().positive().optional(),
      })
      .strict(),
  },

  /** @legacy PATCH /api/staff/players/:id */
  update: {
    params: z.object({ playerId }).strict(),
    body: z
      .object({
        username: username.optional(),
        email: z.string().trim().email().max(160).optional(),
        phone: z.string().trim().max(30).optional(),
        country: z.string().trim().max(80).optional(),
        password: password.optional(),
        parentId: z.coerce.number().int().positive().optional(),
      })
      .strict()
      .refine((body) => Object.keys(body).length > 0, { message: 'No changes were supplied' }),
  },

  /**
   * @legacy DELETE /api/staff/players/:id
   *
   * A reason is required. Closing a customer account is a decision somebody
   * should have to justify in the audit trail — legacy recorded nothing beyond
   * the fact that it happened, and what it did was irreversible.
   */
  close: {
    params: z.object({ playerId }).strict(),
    body: z.object({ reason: z.string().trim().min(3).max(300) }).strict(),
  },
};
