'use strict';

const { z } = require('@ibitplay/common');
const { SUPPORTED_CURRENCIES } = require('../wallet/wallet.constants');

/**
 * A rate is money-adjacent: it decides how much a player receives from a swap,
 * so it gets the same string treatment as an amount. A float rate that drifts
 * in the eighth decimal place moves real money at volume.
 */
const rate = z
  .string({ required_error: 'usdRate is required', invalid_type_error: 'usdRate must be sent as a string' })
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, 'usdRate must be a positive decimal with at most 8 decimal places')
  .refine((v) => Number.parseFloat(v) > 0, 'usdRate must be greater than zero');

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => SUPPORTED_CURRENCIES.includes(v), {
    message: `currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
  });

const currencyParam = { params: z.object({ currency }) };

const convert = {
  query: z.object({
    from: currency,
    to: currency,
    amount: z.string().trim().regex(/^\d+(\.\d{1,8})?$/, 'amount must be a positive decimal'),
  }),
};

/** The legacy path form: /convert/:from/:to/:amount */
const convertParams = {
  params: z.object({
    from: currency,
    to: currency,
    amount: z.string().trim().regex(/^\d+(\.\d{1,8})?$/, 'amount must be a positive decimal'),
  }),
};

const addRate = {
  body: z.object({ currency, usdRate: rate }).strict(),
};

const updateRate = {
  params: z.object({ currency }),
  body: z.object({ usdRate: rate }).strict(),
};

module.exports = { convert, convertParams, currencyParam, addRate, updateRate, rate, currency };
