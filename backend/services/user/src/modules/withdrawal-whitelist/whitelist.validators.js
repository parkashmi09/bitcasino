'use strict';

const { z } = require('@ibitplay/common');

/**
 * The address is bounded, not validated.
 *
 * A character class and a length, so nothing that could not be an address on
 * any chain is storable — no whitespace, no markup. What is deliberately NOT
 * here is a per-network format or checksum rule: see migration 039.
 *
 * No `.toLowerCase()`. Several chains are case-sensitive and one is
 * case-CHECKSUMMED, so normalising the case can invalidate a correct address.
 */
const address = z
  .string({ required_error: 'address is required' })
  .trim()
  .min(4, 'address is too short')
  .max(190, 'address is too long')
  .regex(/^[A-Za-z0-9:_-]+$/, 'address may contain letters, digits and : _ - only');

const label = z.string().trim().min(1, 'label is required').max(60);

const create = {
  body: z
    .object({
      label,
      currency: z.string().trim().min(2).max(20),
      network: z.string().trim().max(40).optional(),
      address,
      memo: z.string().trim().max(120).optional(),
    })
    .strict(),
};

/** Only the label is mutable — see `rename` in the service for why. */
const rename = {
  params: z.object({ id: z.string().trim().regex(/^\d+$/, 'id must be numeric') }),
  body: z.object({ label }).strict(),
};

const idParam = {
  params: z.object({ id: z.string().trim().regex(/^\d+$/, 'id must be numeric') }),
};

/**
 * `z.enum` and not `z.coerce.boolean()`, which maps every non-empty string —
 * `"false"` included — to `true`. This one decides whether withdrawals are
 * restricted, so getting it backwards is the worst possible place for that
 * trap. It is a JSON body rather than a query, so a real boolean is accepted
 * too; the union takes both and normalises.
 */
const enforcement = {
  body: z
    .object({
      enabled: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]),
    })
    .strict(),
};

module.exports = { create, rename, idParam, enforcement };
