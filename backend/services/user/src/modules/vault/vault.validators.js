'use strict';

const { z } = require('@ibitplay/common');
const { currency } = require('../exchange-rate/exchangeRate.validators');
const { moneyAmount } = require('../wallet/wallet.validators');

const lockPeriod = z.string().trim().min(1).max(50);

const transferIn = {
  body: z.object({ coin: currency, amount: moneyAmount, lockPeriod }).strict(),
};

const transferOut = {
  body: z.object({ depositId: z.coerce.number().int().positive(), coin: currency }).strict(),
};

const listing = {
  query: z.object({
    coin: currency.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

const upsertRate = {
  body: z
    .object({
      lockPeriod,
      label: z.string().trim().min(1).max(100),
      days: z.coerce.number().int().min(1).max(3650),
      // Annual percentage: 7.5 means 7.5%. A string, because it multiplies money.
      rate: z.string().trim().regex(/^\d+(\.\d{1,4})?$/, 'rate must be a positive decimal'),
    })
    .strict(),
};

const updateRate = {
  body: z
    .object({
      lockPeriod,
      rate: z.string().trim().regex(/^\d+(\.\d{1,4})?$/, 'rate must be a positive decimal'),
    })
    .strict(),
};

const deleteRate = { body: z.object({ lockPeriod }).strict() };

module.exports = { transferIn, transferOut, listing, upsertRate, updateRate, deleteRate };
