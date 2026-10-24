'use strict';

const { z } = require('@ibitplay/common');

const { V1_CURRENCIES, V2_CURRENCIES } = require('./jsGames.constants');

const gameUid = z.string().trim().min(1).max(190);

const paging = {
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
};

/**
 * Launching a game.
 *
 * NOTE THE ABSENCE OF `user_id`, and of `credit_amount`. Legacy read the player
 * from the body on an unauthenticated route, and let the caller name the credit
 * the game would open with (defaulting to the string `'50'`). The player comes
 * from the token and the credit from their real balance.
 */
const launchV1 = {
  body: z
    .object({
      gameUid,
      currencyCode: z.enum(Object.keys(V1_CURRENCIES)),
      language: z.string().trim().max(10).optional(),
      homeUrl: z.string().trim().url().max(2048).optional(),
    })
    .strict(),
};

const launchV2 = {
  body: z
    .object({
      gameUid,
      currencyCode: z.enum(Object.keys(V2_CURRENCIES)),
      language: z.string().trim().max(10).optional(),
    })
    .strict(),
};

const transferV1 = {
  body: z
    .object({
      userId: z.coerce.number().int().positive(),
      gameUid,
      amount: z.string().trim().regex(/^\d+(\.\d{1,8})?$/, 'amount must be a positive decimal'),
      transferType: z.enum(['deposit', 'withdrawal']),
      currencyCode: z.enum(Object.keys(V1_CURRENCIES)),
    })
    .strict(),
};

const transactionsV1 = {
  body: z
    .object({
      fromDate: z.string().trim().min(8).max(35),
      toDate: z.string().trim().min(8).max(35),
      pageNo: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(500).default(30),
    })
    .strict()
    // The provider rejects a reversed range with a code the operator would have
    // to look up; refusing here says what is wrong.
    .refine((v) => new Date(v.toDate) >= new Date(v.fromDate), {
      message: 'toDate must not be before fromDate',
      path: ['toDate'],
    }),
};

const listGames = {
  query: z.object({ ...paging, vendor: z.string().trim().max(120).optional() }).strict(),
};

const searchGames = {
  query: z
    .object({
      ...paging,
      keyword: z.string().trim().max(120).default(''),
      vendor: z.string().trim().max(120).optional(),
    })
    .strict(),
};

module.exports = { launchV1, launchV2, transferV1, transactionsV1, listGames, searchGames };
