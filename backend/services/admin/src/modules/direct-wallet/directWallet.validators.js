'use strict';

const { z } = require('@ibitplay/common');

const paging = {
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
};

const userId = z.coerce.number().int().positive();
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{2,10}$/, 'unknown currency');

/** GET /direct-wallet/currencies */
const currencies = { query: z.object({}).strict() };

/** GET /direct-wallet/users — direct users + balances. */
const users = {
  query: z.object({ ...paging, search: z.string().trim().max(80).optional() }).strict(),
};

/** POST /direct-wallet/adjust — crypto ke liye 8 decimal tak. */
const adjust = {
  body: z
    .object({
      userId,
      currency,
      amount: z
        .string({ invalid_type_error: 'send the amount as a string, not a number' })
        .trim()
        .regex(/^\d+(\.\d{1,8})?$/, 'must be a positive amount with at most 8 decimal places')
        .refine((v) => Number.parseFloat(v) > 0, 'amount must be greater than zero'),
      operation: z.enum(['credit', 'debit']),
      note: z.string().trim().max(200).optional(),
      transactionPassword: z.string().min(1).max(200),
    })
    .strict(),
};

/** GET /direct-wallet/users/:userId/history */
const history = {
  params: z.object({ userId }).strict(),
  query: z.object({ ...paging, currency: currency.optional() }).strict(),
};

module.exports = { currencies, users, adjust, history };
