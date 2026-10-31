'use strict';

const { z } = require('@ibitplay/common');
const { SUPPORTED_CURRENCIES, REASON } = require('./wallet.constants');

/**
 * Wallet request schemas.
 *
 * The rule this file exists to enforce: **money is a string, never a number.**
 *
 *   z.number()  parses "0.1" into an IEEE-754 double. 0.1 + 0.2 is then
 *               0.30000000000000004, and a platform that loses a satoshi per
 *               bet loses real money at scale.
 *
 *   amount      is a string matched against a decimal pattern, carried as a
 *               string all the way to Postgres NUMERIC(30,8), and only ever
 *               operated on through `@ibitplay/common/money` (BigInt minor units).
 *
 * `z.coerce.number()` would be just as wrong, which is why the pattern is
 * explicit rather than a `.refine()` on a numeric type.
 */

/** A positive decimal with at most 8 places. Rejects "1e5", "-5", "1.234567891", "". */
const moneyAmount = z
  .string({ required_error: 'amount is required', invalid_type_error: 'amount must be sent as a string' })
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, 'amount must be a positive decimal with at most 8 decimal places')
  .refine((v) => Number.parseFloat(v) > 0, 'amount must be greater than zero');

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => SUPPORTED_CURRENCIES.includes(v), {
    message: `currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
  });

const userId = z.coerce.number().int().positive();

/**
 * The caller-supplied replay key.
 *
 * Required on every internal movement. Made required rather than optional on
 * purpose: an optional idempotency key is one a caller forgets, and the failure
 * only shows up as a double payout under a network blip.
 */
const idempotencyKey = z
  .string()
  .trim()
  .min(8, 'idempotencyKey must be at least 8 characters')
  .max(120)
  .regex(/^[A-Za-z0-9:_.\-]+$/, 'idempotencyKey may contain letters, digits and : _ . - only');

const reason = z.enum(Object.values(REASON));

// ── Internal: service-to-service movements ─────────────────────────────

/** POST /internal/user/wallet/debit and /credit share this body. */
const movement = {
  body: z
    .object({
      userId,
      currency,
      amount: moneyAmount,
      reason,
      idempotencyKey,

      // Where the money came from or went, for reconciliation.
      refType: z.string().trim().max(50).optional(),
      refId: z.coerce.string().trim().max(128).optional(),
      description: z.string().trim().max(500).optional(),

      // Sports settlement context, carried onto the ledger row.
      matchId: z.coerce.string().trim().max(64).optional(),
      marketType: z.string().trim().max(100).optional(),
      sportId: z.coerce.string().trim().max(64).optional(),
      eventId: z.string().trim().max(64).optional(),
      betId: z.coerce.number().int().positive().optional(),
    })
    .strict(),
};

/** POST /internal/user/wallet/rollback */
const rollback = {
  body: z
    .object({
      ledgerId: z.coerce.number().int().positive(),
      idempotencyKey,
      reason: z.string().trim().max(255).default('Compensating rollback'),
    })
    .strict(),
};

/** POST /internal/user/wallet/transfer */
const transfer = {
  body: z
    .object({
      fromUserId: userId,
      toUserId: userId,
      currency,
      amount: moneyAmount,
      idempotencyKey,
      description: z.string().trim().max(500).optional(),
    })
    .strict()
    .refine((v) => v.fromUserId !== v.toUserId, {
      message: 'fromUserId and toUserId must differ',
      path: ['toUserId'],
    }),
};

/** GET /internal/user/wallet/balance/:userId */
const balanceParams = {
  params: z.object({ userId }),
  query: z.object({ currency: currency.optional() }),
};

// ── Player-facing ──────────────────────────────────────────────────────

const listHistory = {
  query: z.object({
    currency: currency.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

const listLedger = {
  query: z.object({
    currency: currency.optional(),
    reason: reason.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

// ── Staff-facing ───────────────────────────────────────────────────────

/**
 * POST /api/v1/admin/user/wallet/adjust
 *
 * @legacy POST /updatebalance and POST /adminwalletadd
 *
 * `operation` is explicit rather than inferred from the sign of the amount:
 * a stray minus in an operator's input should be a validation error, not a
 * debit that was meant to be a credit.
 */
const adminAdjust = {
  body: z
    .object({
      userId,
      currency,
      amount: moneyAmount,
      operation: z.enum(['credit', 'debit']),
      description: z.string().trim().min(1, 'a reason is required').max(500),
      // The operator re-authenticates for a balance change. Legacy checked this
      // too, and it stays because a hijacked admin session is the realistic
      // threat here, not a guessed password.
      transactionPassword: z.string().min(1).optional(),
    })
    .strict(),
};

const adminBalance = {
  params: z.object({ userId }),
};

/**
 * GET /api/v1/admin/user/wallet/balances
 *
 * @legacy GET /getwallet
 *
 * The listing legacy served as `SELECT * FROM credits` with no auth, no paging
 * and no scoping. Paged and capped here — the operator console loads a page at
 * a time and searches server-side, so a 40k-player table is never one response.
 */
const adminListBalances = {
  query: z
    .object({
      search: z.string().trim().max(190).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .strict(),
};

const adminHistory = {
  params: z.object({ userId }),
  query: z.object({
    currency: currency.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

/**
 * One currency, by name in the path.
 *
 * The value is validated against the wallet's own allow-list before it is used
 * for anything. Legacy interpolated `coin_symbol` into the SELECT and guarded
 * it with a hand-written array that had drifted from the actual columns.
 */
const balanceOf = {
  params: z.object({
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => SUPPORTED_CURRENCIES.includes(v), {
        message: `currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
      }),
  }),
};

module.exports = {
  balanceOf,
  movement,
  rollback,
  transfer,
  balanceParams,
  listHistory,
  listLedger,
  adminAdjust,
  adminBalance,
  adminListBalances,
  adminHistory,
  // exported for reuse by other modules that move money
  moneyAmount,
  currency,
  idempotencyKey,
};
