'use strict';

const { z } = require('@ibitplay/common');

const { ACCOUNT_TYPES, ACCOUNT_STATUS, BET_STATUS } = require('./lords.constants');

const id = z.coerce.number().int().positive();
const accountType = z.enum(ACCOUNT_TYPES);

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Money as a string. Legacy did `Number(amount)` and compared it to a NUMERIC. */
const amount = z
  .string({ invalid_type_error: 'send the amount as a string, not a number' })
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, 'must be a positive decimal with at most 8 decimal places')
  .refine((v) => Number.parseFloat(v) > 0, 'amount must be greater than zero');

/** A limit may be zero — that is how an operator switches one off. */
const limitAmount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, 'must be a non-negative decimal with at most 8 decimal places');

/**
 * The operator's second factor.
 *
 * Required on every write here. Legacy required it too and it is the one
 * control that separates a stolen session from a decision.
 */
const transactionPassword = z.string().min(1).max(200);

const newPassword = z.string().min(12, 'must be at least 12 characters').max(200);

const setPassword = {
  body: z.object({ accountType, accountId: id, newPassword, transactionPassword }).strict(),
};

const setStatus = {
  body: z
    .object({
      accountType,
      accountId: id,
      transactionPassword,
      status: z.enum(ACCOUNT_STATUS).optional(),
      betStatus: z.enum(BET_STATUS).optional(),
      // Real booleans. A coerced `"false"` is truthy and would LOCK an account
      // somebody meant to unlock, or the reverse.
      sportsLocked: z.boolean().optional(),
      casinoLocked: z.boolean().optional(),
      systemLocked: z.boolean().optional(),
    })
    .strict()
    .refine(
      (v) =>
        ['status', 'betStatus', 'sportsLocked', 'casinoLocked', 'systemLocked'].some(
          (k) => v[k] !== undefined
        ),
      { message: 'give at least one setting to change' }
    ),
};

const setExposureLimit = {
  body: z.object({ accountType, accountId: id, exposureLimit: limitAmount, transactionPassword }).strict(),
};

const setCreditLimit = {
  body: z.object({ accountId: id, creditLimit: limitAmount, transactionPassword }).strict(),
};

/** No `fromId`. The payer is the authenticated operator. */
const refill = {
  body: z
    .object({
      accountId: id,
      amount,
      note: z.string().trim().max(200).optional(),
      transactionPassword,
    })
    .strict(),
};

const transferStatement = {
  query: paging.extend({
    accountType: accountType.optional(),
    accountId: id.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }),
};

/**
 * `parentId` drills one level down into a sub-agent. Absent means "my own
 * children". It is checked against the caller's tree in the service — a query
 * parameter naming an account is a request, not a permission.
 */
const allDetails = {
  query: paging.extend({
    search: z.string().trim().max(120).optional(),
    parentId: id.optional(),
  }),
};

module.exports = {
  setPassword, setStatus, setExposureLimit, setCreditLimit,
  refill, transferStatement, allDetails,
};
