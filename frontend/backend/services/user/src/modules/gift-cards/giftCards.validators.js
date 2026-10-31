'use strict';

const { z } = require('@ibitplay/common');

const { moneyAmount } = require('../wallet/wallet.validators');

const id = z.coerce.number().int().positive();

const create = {
  body: z
    .object({
      uniqueKey: z.string().trim().min(1).max(80),
      description: z.string().trim().max(500).optional(),
      amount: moneyAmount,

      // How long after activation the conditions stay open.
      periodDays: z.coerce.number().int().min(1).max(3650).optional(),
      endDate: z.string().trim().min(8).max(35).optional(),

      depositRequired: z.coerce.boolean().default(false),
      depositAmount: moneyAmount.optional(),
      wagerRequired: z.coerce.boolean().default(false),
      wagerTimes: z.coerce.number().int().min(0).max(10_000).optional(),

      allUsers: z.coerce.boolean().default(false),
      isActive: z.coerce.boolean().default(true),
    })
    .strict()
    // A condition switched on with no figure behind it is always met, which
    // turns a "deposit $100 first" card into a free one.
    .refine((v) => !v.depositRequired || v.depositAmount != null, {
      message: 'depositAmount is required when depositRequired is true',
      path: ['depositAmount'],
    })
    .refine((v) => !v.wagerRequired || v.wagerTimes != null, {
      message: 'wagerTimes is required when wagerRequired is true',
      path: ['wagerTimes'],
    }),
};

const listing = {
  query: z.object({
    activeOnly: z.coerce.boolean().optional(),
    search: z.string().trim().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

const records = {
  query: z.object({
    status: z.enum(['Activated', 'Claimed', 'Expired']).optional(),
    userId: id.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

const idParam = { params: z.object({ id }) };

const search = { body: z.object({ uniqueKey: z.string().trim().min(1).max(80) }).strict() };

/**
 * Note the absence of `userId`. Legacy took it from the body on both of these,
 * unauthenticated — so anyone could activate or claim on anyone's behalf.
 */
const cardAction = { body: z.object({ giftCardId: id }).strict() };

const paging = {
  query: z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

module.exports = { create, listing, records, idParam, search, cardAction, paging };
