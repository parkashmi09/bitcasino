'use strict';

const { z } = require('@ibitplay/common');
const { LEGACY_FIELD_ALIASES } = require('./locks.constants');

const id = z.coerce.number().int().positive();

/**
 * The lock body.
 *
 * Accepts both the current names and legacy's three, two of which named columns
 * that do not exist — see `locks.constants.js`. A caller sending
 * `all_system_blocked` gets `system_locked` set, which is what they meant and
 * what legacy failed to do.
 */
const lockBody = z
  .object({
    userId: id.optional(),
    staffId: id.optional(),

    system: z.boolean().optional(),
    casino: z.boolean().optional(),
    sports: z.boolean().optional(),

    // Legacy names.
    all_system_blocked: z.boolean().optional(),
    casino_blocked: z.boolean().optional(),
    sports_betlocked: z.boolean().optional(),
  })
  .strict()
  .transform((body) => {
    const locks = {
      ...(body.system !== undefined ? { system: body.system } : {}),
      ...(body.casino !== undefined ? { casino: body.casino } : {}),
      ...(body.sports !== undefined ? { sports: body.sports } : {}),
    };

    for (const [legacyName, current] of Object.entries(LEGACY_FIELD_ALIASES)) {
      // An explicit current-name field wins over its legacy alias, so a client
      // sending both is not surprised by which one applied.
      if (body[legacyName] !== undefined && locks[current] === undefined) {
        locks[current] = body[legacyName];
      }
    }

    return { userId: body.userId, staffId: body.staffId, locks };
  })
  .refine((body) => Object.keys(body.locks).length > 0, { message: 'No lock was named' })
  .refine((body) => Boolean(body.userId) !== Boolean(body.staffId), {
    message: 'Name either a player or an agent, not both',
  });

module.exports = {
  /** @legacy POST /locksystem/update-system-lock */
  updateLocks: { body: lockBody },

  /** @legacy GET /api/public/ref/:slug */
  resolveReferral: {
    params: z
      .object({
        // A slug is an identifier, not free text — it goes into a lookup that
        // is served without authentication.
        slug: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/),
      })
      .strict(),
  },

  /** @legacy GET /api/public/user-transfers/:uid */
  userTransfers: {
    params: z.object({ userId: id }).strict(),
    query: z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .strict(),
  },
};
