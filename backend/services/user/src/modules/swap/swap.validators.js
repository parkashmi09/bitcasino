'use strict';

const { z } = require('@ibitplay/common');
const { currency, supportedCurrency } = require('../exchange-rate/exchangeRate.validators');
const { moneyAmount } = require('../wallet/wallet.validators');

/**
 * The currency fields here are the ones that used to reach SQL as raw text.
 *
 * `legacy/internalswap/controller.js` interpolated them straight into the
 * query — `SET ${fromCurrency.toLowerCase()} = ...` — so they are validated
 * against the supported-currency allow-list before anything else happens.
 *
 * `fromCurrency` may be a retired coin (BJB) so a player can swap a leftover
 * balance out; `toCurrency` may not, because nothing may credit one.
 */
const estimate = {
  query: z
    .object({ fromCurrency: currency, toCurrency: supportedCurrency, amount: moneyAmount }).strict()
    .refine((v) => v.fromCurrency !== v.toCurrency, {
      message: 'fromCurrency and toCurrency must differ',
      path: ['toCurrency'],
    }),
};

const swap = {
  body: z
    .object({ fromCurrency: currency, toCurrency: supportedCurrency, amount: moneyAmount })
    .strict()
    .refine((v) => v.fromCurrency !== v.toCurrency, {
      message: 'fromCurrency and toCurrency must differ',
      path: ['toCurrency'],
    }),
};

const listHistory = {
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict(),
};

const adminHistory = {
  query: z.object({
    userId: z.coerce.number().int().positive().optional(),
    currency: currency.optional(),
    // Direct Users | Agent Users — na ho to sab (purana jawab).
    channel: z.enum(['direct', 'agent']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict(),
};

const userParam = { params: z.object({ userId: z.coerce.number().int().positive() }) };

/** The fee summary: one user, or every direct user. */
const adminSummary = {
  query: z.object({ userId: z.coerce.number().int().positive().optional(), channel: z.enum(['direct', 'agent']).optional() }).strict(),
};

/** The fee earnings by day, paged. */
const feeHistory = {
  query: z.object({
    userId: z.coerce.number().int().positive().optional(),
    channel: z.enum(['direct', 'agent']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict(),
};

/** The swap fee as a fraction, 0 to 0.5 (0% to 50%), at most 4 decimals ("0.0125" is 1.25%). */
const setFee = {
  body: z.object({ fee: z.string().regex(/^0(\.\d{1,4})?$/).refine(f => Number(f) <= 0.5, 'At most 0.5 (50%)') }).strict(),
};

module.exports = { estimate, swap, listHistory, adminHistory, adminSummary, feeHistory, setFee, userParam };
