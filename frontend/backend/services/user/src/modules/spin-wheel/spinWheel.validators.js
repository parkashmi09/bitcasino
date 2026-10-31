'use strict';

const { z } = require('@ibitplay/common');

const { moneyAmount } = require('../wallet/wallet.validators');

const id = z.coerce.number().int().positive();
const pct = z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, 'must be a percentage like "12.5"');

const slice = z.object({
  label: z.string().trim().min(1).max(50),
  rewardPct: pct.optional(),
  color: z.string().trim().max(10).optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
  isBadLuck: z.coerce.boolean().optional(),
  /**
   * Integer, and at least zero.
   *
   * A negative weight would subtract from the cumulative total and make one
   * slice's probability depend on another's — legacy summed the weights without
   * checking, so a `-5` shifted the whole distribution silently.
   */
  weight: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const updateConfig = {
  body: z
    .object({
      minDeposit: moneyAmount.optional(),
      claimCooldownDays: z.coerce.number().int().min(0).max(3650).optional(),
      isActive: z.coerce.boolean().optional(),
      unlimitedSpin: z.coerce.boolean().optional(),
    })
    .strict(),
};

const addSlice = { body: slice.strict() };
const updateSlice = { params: z.object({ id }), body: slice.partial().strict() };
const sliceParam = { params: z.object({ id }) };

const bulkSlices = {
  body: z
    .object({
      // At least one, or the wheel has nothing to land on and every spin fails.
      slices: z.array(slice.strict()).min(1).max(60),
    })
    .strict()
    // Every weight zero means no valid draw. Caught here rather than at spin
    // time, where it would be an outage for players rather than a validation
    // error for the person who caused it.
    .refine((v) => v.slices.some((s) => (s.weight ?? 1) > 0), {
      message: 'at least one segment must have a weight above zero',
      path: ['slices'],
    }),
};

const listing = {
  query: z.object({
    userId: id.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

/** No `user_id` — legacy took it from the query string and the body. */
const paging = {
  query: z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

module.exports = { updateConfig, addSlice, updateSlice, sliceParam, bulkSlices, listing, paging };
