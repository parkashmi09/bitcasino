'use strict';

const { z } = require('@ibitplay/common');

const { currency } = require('../exchange-rate/exchangeRate.validators');

/** ISO date, or an ISO datetime. Both are accepted; both mean a whole day. */
const date = z.string().trim().min(8).max(35);

const listing = z.object({
  status: z.enum(['success', 'pending', 'failed']).optional(),
  startDate: date.optional(),
  endDate: date.optional(),
  userid: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(10),
  page: z.coerce.number().int().min(1).default(1),
}).strict();

const cryptoList = {
  query: listing.extend({
    chain: z.string().trim().min(1).max(20).optional(),
    // The coin (ticker) — the site admin's currency filter on Finance → Deposits → Crypto.
    coin: z.string().trim().toUpperCase().min(2).max(12).regex(/^[A-Z0-9]+$/).optional(),
    // Direct Users | Agent Users — na ho to sab (purana jawab).
    channel: z.enum(['direct', 'agent']).optional(),
  }),
};

const cryptoStats = {
  query: z.object({ startDate: date.optional(), endDate: date.optional() }).strict(),
};

const fiatList = {
  query: listing.extend({
    currency: currency.optional(),
    provider: z.enum(['waypay', 'apay', 'manual', 'cricpay']).optional(),
  }),
};

const fiatStats = {
  query: z.object({
    startDate: date.optional(),
    endDate: date.optional(),
    currency: currency.optional(),
  }).strict(),
};

/**
 * A profit-and-loss lookup.
 *
 * A GET with the id in the path, not legacy's POST with it in the body — this
 * reads and writes nothing. And there is no `staffId` parameter naming who is
 * asking: that comes from the token.
 */
const userProfitLoss = { params: z.object({ userId: z.coerce.number().int().positive() }) };
const staffProfitLoss = { params: z.object({ staffId: z.coerce.number().int().positive() }) };

module.exports = {
  userProfitLoss,
  staffProfitLoss, cryptoList, cryptoStats, fiatList, fiatStats };
