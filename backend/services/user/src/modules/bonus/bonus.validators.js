'use strict';

const { z } = require('@ibitplay/common');

const { moneyAmount, idempotencyKey } = require('../wallet/wallet.validators');
const { BONUS_TYPE_NAMES, GAME_COUNTERS } = require('./bonus.constants');

const userId = z.coerce.number().int().positive();
const bonusType = z.enum(BONUS_TYPE_NAMES);

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** No `userid`. Legacy read it from the query string on every one of these. */
const myPaging = { query: paging };

const claimType = { params: z.object({ type: bonusType }) };

/**
 * A redeem code.
 *
 * Upper-cased so a player typing a code from a screenshot in lower case still
 * matches — codes are issued upper-case, and the lookup is exact.
 */
const redeem = {
  body: z
    .object({ code: z.string().trim().toUpperCase().min(4).max(40).regex(/^[A-Z0-9-]+$/) })
    .strict(),
};

const myCodes = {
  query: paging.extend({ status: z.enum(['active', 'redeemed', 'expired', 'superseded']).optional() }),
};

// ── Staff ─────────────────────────────────────────────────────────────

const listRecords = { query: paging.extend({ userId: userId.optional() }) };

const listAwards = {
  query: paging.extend({
    userId: userId.optional(),
    type: bonusType.optional(),
    claimed: z.coerce.boolean().optional(),
  }),
};

const listCodes = {
  query: paging.extend({
    userId: userId.optional(),
    status: z.enum(['active', 'redeemed', 'expired', 'superseded']).optional(),
  }),
};

const createRecord = {
  body: z.object({ userId, name: z.string().trim().max(120).optional() }).strict(),
};

const updateRecord = {
  body: z
    .object({
      userId,
      daily: moneyAmount.optional(),
      weekly: moneyAmount.optional(),
      monthly: moneyAmount.optional(),
    })
    .strict()
    // An update naming no figures would silently do nothing and report success.
    .refine((v) => BONUS_TYPE_NAMES.some((t) => v[t] !== undefined), {
      message: 'at least one bonus amount must be given',
    }),
};

const deleteRecord = { body: z.object({ userId }).strict() };

const createCode = {
  body: z
    .object({
      userId,
      code: z.string().trim().toUpperCase().min(4).max(40).regex(/^[A-Z0-9-]+$/),
      amount: moneyAmount,
    })
    .strict(),
};

const userParam = { params: z.object({ userId }) };

// ── Per-game counters ──────────────────────────────────────────────────

/**
 * One optional non-negative amount per known counter.
 *
 * `.strict()` matters more than usual here: the keys that survive validation
 * are used as SQL identifiers by `Bonusgame.increment`, so an unknown key must
 * be rejected rather than passed through. The service filters against
 * `GAME_COUNTERS` as well — two independent gates on the same thing, because
 * one of them being removed later should not open an injection point.
 *
 * Negative amounts are refused. These counters record what has been granted,
 * cumulatively; a negative "grant" would both corrupt that record and, since
 * the total is paid into the balance, attempt a credit of a negative sum.
 * Taking money back is a debit, and it belongs on the wallet's adjust endpoint
 * where it is named as one.
 */
const counterAmounts = Object.fromEntries(
  GAME_COUNTERS.map((name) => [name, moneyAmount.optional()])
);

const atLeastOneCounter = (value) => GAME_COUNTERS.some((name) => value[name] !== undefined);

const createBonusGame = {
  body: z.object({ userId, ...counterAmounts }).strict(),
};

const grantBonusGame = {
  body: z
    .object({ userId, idempotencyKey, note: z.string().trim().max(200).optional(), ...counterAmounts })
    .strict()
    // A grant naming no counter would credit zero and report success.
    .refine(atLeastOneCounter, { message: 'at least one bonus counter must be given' }),
};

const deleteBonusGame = { body: z.object({ userId }).strict() };

// ── The event log ──────────────────────────────────────────────────────

const eventId = z.coerce.number().int().positive();

const createEvent = {
  body: z
    .object({ userId, event: z.string().trim().min(1).max(200), amount: moneyAmount })
    .strict(),
};

const updateEvent = {
  params: z.object({ id: eventId }),
  body: z
    .object({ event: z.string().trim().min(1).max(200).optional(), amount: moneyAmount.optional() })
    .strict()
    .refine((v) => v.event !== undefined || v.amount !== undefined, {
      message: 'give an event name, an amount, or both',
    }),
};

const eventParam = { params: z.object({ id: eventId }) };

const dashboard = {
  query: paging.extend({
    userId: userId.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  }),
};

module.exports = {
  myPaging, claimType, redeem, myCodes,
  listRecords, listAwards, listCodes,
  createRecord, updateRecord, deleteRecord, createCode, userParam,
  createBonusGame, grantBonusGame, deleteBonusGame,
  createEvent, updateEvent, eventParam, dashboard,
};
