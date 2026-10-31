'use strict';

const { z } = require('@ibitplay/common');
const { currency } = require('../exchange-rate/exchangeRate.validators');
const { moneyAmount } = require('../wallet/wallet.validators');

const lockPeriod = z.string().trim().min(1).max(50);

const transferIn = {
  body: z.object({ coin: currency, amount: moneyAmount, lockPeriod }).strict(),
};

const rateString = z.string().trim().regex(/^\d+(\.\d{1,4})?$/, 'rate must be a positive decimal');

const earlyFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .transform((v) => v === true || v === 'true')
  .default(false);

const transferOut = {
  body: z
    .object({
      depositId: z.coerce.number().int().positive(),
      coin: currency,
      early: earlyFlag,
    })
    .strict(),
};

const listing = {
  query: z.object({
    coin: currency.optional(),
    // Direct Users | Agent Users — na ho to sab (purana jawab).
    channel: z.enum(['direct', 'agent']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict(),
};

const upsertRate = {
  body: z
    .object({
      lockPeriod,
      label: z.string().trim().min(1).max(100),
      days: z.coerce.number().int().min(1).max(3650),
      // Annual percentage: 7.5 means 7.5%. A string, because it multiplies money.
      rate: rateString,
      earlyPenaltyRate: rateString.optional(),
    })
    .strict(),
};

const updateRate = {
  body: z
    .object({
      lockPeriod,
      rate: rateString.optional(),
      earlyPenaltyRate: rateString.optional(),
    })
    .strict()
    .refine(
      (body) => body.rate !== undefined || body.earlyPenaltyRate !== undefined,
      { message: 'Provide rate or earlyPenaltyRate' }
    ),
};

const deleteRate = { body: z.object({ lockPeriod }).strict() };

module.exports = { transferIn, transferOut, listing, upsertRate, updateRate, deleteRate };
