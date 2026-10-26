'use strict';

const { z } = require('@ibitplay/common');
const { currency } = require('../exchange-rate/exchangeRate.validators');

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /**
   * Bounded because the combined endpoints merge seven tables in memory and
   * must fetch `offset + limit` rows from each to know which survive the sort.
   * An unbounded offset makes one request read every payment row a player has.
   */
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).strict();

/**
 * `status` is matched against the NORMALISED status — the lowercase word the
 * caller sees — not a rail's raw column value, because the seven tables spell
 * the same state four different ways. See `#whereFor`.
 */
const listMine = {
  query: paging.extend({
    currency: currency.optional(),
    status: z.string().trim().max(50).optional(),
  }),
};

const listAll = {
  query: paging.extend({
    currency: currency.optional(),
    userId: z.coerce.number().int().positive().optional(),
    status: z.string().trim().max(50).optional(),
  }),
};

const userParam = { params: z.object({ userId: z.coerce.number().int().positive() }) };

const statsQuery = { query: z.object({ currency: currency.optional() }).strict() };

/** Internal, for admin-service's branch reports: every rail of one branch's players. */
const branch = {
  query: paging.extend({
    kind: z.enum(['deposits', 'withdrawals']),
    branchId: z.coerce.number().int().positive(),
    userId: z.coerce.number().int().positive().optional(),
    status: z.string().trim().max(50).optional(),
  }),
};

module.exports = { listMine, listAll, userParam, statsQuery, branch };
