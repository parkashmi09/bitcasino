'use strict';

const { z } = require('@ibitplay/common');
const { currency } = require('../exchange-rate/exchangeRate.validators');
const { moneyAmount } = require('../wallet/wallet.validators');

/**
 * The currency fields here are the ones that used to reach SQL as raw text.
 *
 * `legacy/internalswap/controller.js` interpolated them straight into the
 * query — `SET ${fromCurrency.toLowerCase()} = ...` — so they are validated
 * against the supported-currency allow-list before anything else happens.
 */
const estimate = {
  query: z
    .object({ fromCurrency: currency, toCurrency: currency, amount: moneyAmount })
    .refine((v) => v.fromCurrency !== v.toCurrency, {
      message: 'fromCurrency and toCurrency must differ',
      path: ['toCurrency'],
    }),
};

const swap = {
  body: z
    .object({ fromCurrency: currency, toCurrency: currency, amount: moneyAmount })
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
  }),
};

const adminHistory = {
  query: z.object({
    userId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

const userParam = { params: z.object({ userId: z.coerce.number().int().positive() }) };

module.exports = { estimate, swap, listHistory, adminHistory, userParam };
