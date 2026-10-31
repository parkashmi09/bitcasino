'use strict';

const { z } = require('@ibitplay/common');

const { SUPPORTED_COINS } = require('./crypto.constants');

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * A coin symbol.
 *
 * Enumerated, not pattern-matched. The webhook path uses the same set to pick
 * a `credits` column, and legacy interpolated whatever arrived into the SQL —
 * a regex would still be a value from outside choosing an identifier.
 */
const coinDetails = { query: z.object({ symbol: z.enum(SUPPORTED_COINS) }) };

/** No `name`. Legacy read it from the body on an unauthenticated route. */
const inrHistory = { query: paging };

/**
 * @legacy POST /hr
 *
 * Recording an INR deposit somebody says they made.
 *
 * `uid` was one of six fields legacy took straight from an unauthenticated
 * body, with `Access-Control-Allow-Origin: *`. The amount is a decimal STRING
 * here — legacy passed whatever arrived into the INSERT.
 */
const recordInrDeposit = {
  body: z
    .object({
      userId: z.coerce.number().int().positive(),
      amount: z.string().trim().regex(/^\d+(\.\d{1,8})?$/, 'An amount must be a positive decimal string'),
      transactionId: z.string().trim().min(1).max(120),
      status: z.enum(['pending', 'success', 'failed']).default('pending'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .strict(),
};

module.exports = { coinDetails, inrHistory, recordInrDeposit };
