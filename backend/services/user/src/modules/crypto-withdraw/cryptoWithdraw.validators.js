'use strict';

const { z } = require('@ibitplay/common');

const { STATUSES } = require('./cryptoWithdraw.constants');

const id = z.coerce.number().int().positive();

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Coin tickers are short and uppercase. Legacy compared them unnormalised. */
const coin = z.string().trim().toUpperCase().min(2).max(12).regex(/^[A-Z0-9]+$/);

const status = z.enum(STATUSES);

/** No `uid`. Legacy read it from `?uid=` on an unauthenticated route. */
const listMine = {
  query: paging.extend({
    // Legacy's spelling. Only `today` did anything; every other value fell
    // through to "all", so it is enumerated rather than accepted loosely.
    filter: z.enum(['today', 'all']).default('all'),
  }),
};

const listAll = {
  query: paging.extend({
    status: status.optional(),
    userId: id.optional(),
    coin: coin.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }),
};

const userParam = { params: z.object({ userId: id }) };

/**
 * The decision.
 *
 * `status` is an enum, not the free string legacy accepted — `UPDATE
 * withdrawals SET status = $1` wrote whatever arrived, and the alert
 * classifier beside it matched a fixed list, so a near-miss like `'complete'`
 * stored fine, fired no alert, and read as settled to whichever screens
 * matched loosely.
 */
const decide = {
  params: z.object({ withdrawalId: id }),
  body: z
    .object({
      status,
      /**
       * The on-chain hash. Hex or base58 depending on the chain, so this checks
       * shape and length rather than trying to validate a specific format —
       * a wrong-but-plausible hash is caught by the unique index and by the
       * person who follows it, not by a regex.
       */
      txid: z.string().trim().min(16).max(120).regex(/^[A-Za-z0-9]+$/).optional(),
      comment: z.string().trim().max(500).optional(),
    })
    .strict(),
};

module.exports = { listMine, listAll, userParam, decide };
