'use strict';

const { z } = require('@ibitplay/common');

const username = z.string().trim().min(3).max(60);
const password = z.string().min(8).max(200);
const playerId = z.coerce.number().int().positive();

module.exports = {
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
