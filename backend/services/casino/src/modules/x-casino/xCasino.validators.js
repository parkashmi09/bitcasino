'use strict';

const { z } = require('@ibitplay/common');

const { COIN_COLUMNS, TRANSACTION_TYPE } = require('./xCasino.constants');

/**
 * A currency the platform actually holds.
 *
 * An enum, not a pattern — this value chose a SQL identifier in legacy. Even
 * though it no longer can, refusing it at the edge means the service never
 * sees one it would have to reject.
 */
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => Boolean(COIN_COLUMNS[value]), { message: 'That currency is not held on this platform' });

/** Money as a decimal string, never a number. */
const amount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, 'An amount must be a non-negative decimal string');

/**
 * The provider sends amounts as JSON numbers, so they arrive as numbers and
 * have to be accepted as such — but they are converted to a string BEFORE any
 * arithmetic, so the double never reaches the ledger.
 */
const providerAmount = z.union([amount, z.number().nonnegative().finite()]).transform((value) => String(value));

/** The envelope every callback arrives in. */
const callback = (dataShape) =>
  z
    .object({
      command: z.string().trim().min(1).max(60),
      request_timestamp: z.string().trim().min(1).max(40),
      hash: z.string().trim().regex(/^[a-f0-9]{40}$/i, 'A hash is a 40-character SHA-1 digest'),
      data: dataShape,
    })
    .strict();

const session = z.string().trim().min(8).max(255);
const userId = z.coerce.number().int().positive();

module.exports = {
  /**
   * @legacy POST /api/casino/gamerun
   *
   * `user_id` is deliberately NOT here — it comes from the player's token.
   * Legacy took it from the body on a route with no authentication.
   */
  openGame: {
    body: z
      .object({
        gameId: z.coerce.number().int().positive(),
        currency,
        mode: z.enum(['real', 'demo', 'fun']).default('real'),
        language: z.string().trim().max(12).default('en'),
        homeUrl: z.string().trim().url().max(500).optional(),
        device: z.enum(['desktop', 'mobile', 'tablet']).default('desktop'),
        vendor: z.string().trim().max(100).optional(),
        title: z.string().trim().max(255).optional(),
      })
      .strict(),
  },

  /** @legacy POST /api/casino/authenticate */
  authenticate: { body: callback(z.object({ session }).passthrough()) },

  /** @legacy POST /api/casino/balance */
  balance: {
    body: callback(
      z
        .object({
          session,
          user_id: userId,
          currency_code: z.string().trim().max(20).optional(),
        })
        .passthrough()
    ),
  },

  /** @legacy POST /api/casino/changebalance */
  changeBalance: {
    body: callback(
      z
        .object({
          session: session.optional(),
          user_id: userId,
          transaction_id: z.string().trim().min(1).max(120),
          round_id: z.string().trim().max(120).optional(),
          transaction_type: z.enum(Object.values(TRANSACTION_TYPE)),
          amount: providerAmount,
          currency_code: z.string().trim().max(20).optional(),
          round_finished: z.coerce.boolean(),
          game_id: z.union([z.string().trim().max(120), z.number()]).optional(),
          reason: z.string().trim().max(500).optional(),
          transaction_timestamp: z.string().trim().max(40).optional(),
        })
        .passthrough()
    ),
  },

  /** @legacy POST /api/casino/status */
  status: {
    body: callback(
      z
        .object({
          transaction_id: z.string().trim().min(1).max(120),
          user_id: userId.optional(),
        })
        .passthrough()
    ),
  },

  /** @legacy POST /api/casino/cancel */
  cancel: {
    body: callback(
      z
        .object({
          transaction_id: z.string().trim().min(1).max(120),
          user_id: userId.optional(),
          cancel_transaction_id: z.string().trim().max(120).optional(),
        })
        .passthrough()
    ),
  },

  /**
   * @legacy GET /api/casino/casino-balance
   *
   * The player's own read, from their token rather than a query parameter.
   */
  myBalance: {
    query: z.object({ currency: currency.default('INR') }).strict(),
  },
};
