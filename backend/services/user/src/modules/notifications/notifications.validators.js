'use strict';

const { z } = require('@ibitplay/common');
const { CATEGORY_NAMES } = require('./categories');

/**
 * `?unreadOnly=false` MUST NOT MEAN TRUE.
 *
 * `z.coerce.boolean()` maps every non-empty string to `true`, `"false"`
 * included — the trap `staff.validators.js` and `games.validators.js` each
 * write out at length. It bit here during verification: after `read-all`, a
 * plain `GET /user/notifications` returned zero rows, because this service
 * forwards `unreadOnly` to the internal route as a query STRING and `"false"`
 * arrived there as `true`, quietly filtering the list to unread. The rows
 * looked deleted.
 *
 * Same `flag` shape those two files use: an explicit enum, then a transform.
 */
const flag = (fallback) =>
  z
    .enum(['true', 'false'])
    .default(String(fallback))
    .transform((v) => v === 'true');

/**
 * Paging matches the internal route's own bounds (1..200, default 50) rather
 * than inventing narrower ones — a mismatch here would surface as a 422 from
 * a service the caller cannot see.
 */
const list = {
  query: z
    .object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
      unreadOnly: flag(false),
      /** The panel's tab; `all` is every notification the player may see. */
      category: z.enum(CATEGORY_NAMES).default('all'),
    })
    .strict(),
};

/** The id is a bigint on the wire, so it arrives as a digit string. */
const readOne = {
  params: z.object({ id: z.string().trim().regex(/^\d+$/, 'id must be numeric') }),
};

module.exports = { list, readOne };
