'use strict';

const { z } = require('@ibitplay/common');
const { SUPPORTED_CURRENCIES, KNOWN_CURRENCIES, isCustomCurrency } = require('../wallet/wallet.constants');

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

/**
 * Any coin with a wallet column, retired ones (BJB) included: a rate prices a
 * balance that may still exist, and a player may swap a retired coin OUT.
 * Also any well-formed custom code (an owner-created coin, migration 065):
 * whether one exists is answered by its rate row and by the wallet.
 */
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => KNOWN_CURRENCIES.includes(v) || isCustomCurrency(v), {
    message: `currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}, or a coin the site created`,
  });

/** A coin that may be credited — never a retired one. The target of a swap. Custom codes too. */
const supportedCurrency = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => SUPPORTED_CURRENCIES.includes(v) || isCustomCurrency(v), {
    message: `currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}, or a coin the site created`,
  });

const currencyParam = { params: z.object({ currency }) };

const convert = {
  query: z.object({
    from: currency,
    to: currency,
    amount: z.string().trim().regex(/^\d+(\.\d{1,8})?$/, 'amount must be a positive decimal'),
  }).strict(),
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

module.exports = { convert, convertParams, currencyParam, addRate, updateRate, rate, currency, supportedCurrency };
