'use strict';

const { z } = require('@ibitplay/common');

const { SUPPORTED_CURRENCIES, DEVICES } = require('./gis.constants');

const gameUuid = z.string().trim().min(1).max(190);
const currency = z.enum(SUPPORTED_CURRENCIES);
const epochSeconds = z.coerce.number().int().min(0).max(4_102_444_800);

/**
 * Launching a real-money game.
 *
 * NOTE THE ABSENCE OF `player_id`. Legacy read it from the body on an
 * unauthenticated route, so anyone could open a session against any player's
 * account and play their balance. It comes from the token.
 */
const launch = {
  body: z
    .object({
      gameUuid,
      playerName: z.string().trim().min(1).max(120),
      currency,
      device: z.enum(DEVICES).default('desktop'),
      returnUrl: z.string().trim().url().max(2048).optional(),
      language: z.string().trim().max(10).optional(),
      lobbyData: z.string().trim().max(4000).optional(),
    })
    .strict(),
};

const launchDemo = {
  body: z
    .object({
      gameUuid,
      device: z.enum(DEVICES).default('desktop'),
      returnUrl: z.string().trim().url().max(2048).optional(),
      language: z.string().trim().max(10).optional(),
    })
    .strict(),
};

const lobby = {
  query: z
    .object({
      gameUuid,
      currency,
      technology: z.string().trim().max(60).optional(),
    })
    .strict(),
};

const gameTags = {
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      per_page: z.coerce.number().int().min(1).max(100).default(20),
    })
    .strict(),
};

const freespinBets = {
  query: z.object({ gameUuid, currency }).strict(),
};

/**
 * A freespin campaign.
 *
 * Either `betId` + `denomination`, or `totalBetId` — the provider accepts one
 * pair or the other and rejects a request carrying both incompletely. The
 * cross-field rule lives in the service, because the message it produces is a
 * domain error rather than a shape error.
 */
const setFreespin = {
  body: z
    .object({
      playerId: z.coerce.number().int().positive(),
      playerName: z.string().trim().min(1).max(120),
      currency: z.enum(['USDT', 'INR']),
      quantity: z.coerce.number().int().min(1).max(10_000),
      validFrom: epochSeconds,
      validUntil: epochSeconds,
      freespinId: z.string().trim().min(1).max(190),
      gameUuid,
      betId: z.string().trim().max(190).optional(),
      totalBetId: z.string().trim().max(190).optional(),
      denomination: z.coerce.number().positive().optional(),
    })
    .strict()
    // A window that closes before it opens grants nothing, and the provider
    // accepts it silently.
    .refine((v) => v.validUntil > v.validFrom, {
      message: 'validUntil must be after validFrom',
      path: ['validUntil'],
    }),
};

const freespinId = { query: z.object({ freespinId: z.string().trim().min(1).max(190) }).strict() };
const cancelFreespin = { body: z.object({ freespinId: z.string().trim().min(1).max(190) }).strict() };

const setVoucher = {
  body: z
    .object({
      playerId: z.coerce.number().int().positive(),
      voucherId: z.string().trim().min(1).max(190),
      title: z.string().trim().min(1).max(200),
      currency: z.enum(['USDT', 'INR']),
      initialBalance: z.coerce.number().positive(),
      maxWinnings: z.coerce.number().positive(),
      validUntil: epochSeconds,
      tableIds: z.array(z.union([z.string().trim().min(1).max(120), z.number()])).min(1).max(200),
      shortTerms: z.string().trim().max(2000).optional(),
      termsAndConds: z.string().trim().max(20_000).optional(),
    })
    .strict(),
};

const voucherId = { query: z.object({ voucherId: z.string().trim().min(1).max(190) }).strict() };

const cancelVoucher = {
  body: z
    .object({
      voucherId: z.string().trim().min(1).max(190),
      // The provider's own vocabulary: cancelled by us, forfeited by the player.
      reason: z.enum(['Canceled', 'Forfeited']),
    })
    .strict(),
};

module.exports = {
  launch,
  launchDemo,
  lobby,
  gameTags,
  freespinBets,
  setFreespin,
  freespinId,
  cancelFreespin,
  setVoucher,
  voucherId,
  cancelVoucher,
};
