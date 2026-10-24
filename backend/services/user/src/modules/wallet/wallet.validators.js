'use strict';

const { z } = require('@ibitplay/common');
const { SUPPORTED_CURRENCIES, KNOWN_CURRENCIES, REASON, isCustomCurrency } = require('./wallet.constants');

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

/**
 * Any code a wallet may hold: a built-in column, retired coins (BJB) included,
 * or a well-formed custom code (an owner-created coin, migration 065). For
 * reads and for bodies that may DEBIT a retired balance; a credit of a retired
 * coin is refused by the wallet itself (`WALLET_CURRENCY_RETIRED`), and a
 * custom code the registry does not know by the repository
 * (`WALLET_UNSUPPORTED_CURRENCY`), not here.
 */
const knownCurrency = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => KNOWN_CURRENCIES.includes(v) || isCustomCurrency(v), {
    message: `currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}, or a coin the site created`,
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
      currency: knownCurrency,
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
      // Casino game, for the direct ledger's game_type.
      gameType: z.coerce.string().trim().max(200).optional(),
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
  query: z.object({ currency: knownCurrency.optional() }).strict(),
};

// ── Player-facing ──────────────────────────────────────────────────────

const listHistory = {
  query: z.object({
    currency: knownCurrency.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict(),
};

/**
 * The statement's reason filter: one reason, a comma list, or `REWARDS`.
 *
 * Rakeback claims are written with `rakeback_claim` (not a wallet REASON), so a
 * filter that only accepted `REASON` values 422'd and the Rewards statement
 * could never show them. `REWARDS` is every reason a reward is paid under —
 * VIP, periodic bonuses, affiliate rewards and commission, registration and
 * first-deposit bonuses (all `BONUS`) plus rakeback claims.
 */
const LEDGER_EXTRA_REASONS = Object.freeze(['rakeback_claim']);
const REWARD_REASONS = Object.freeze([REASON.BONUS, 'rakeback_claim']);
const ledgerReason = z.preprocess(
  (v) => {
    if (v === undefined || v === '') return undefined;
    const parts = String(v).split(',').map((p) => p.trim()).filter(Boolean);
    return [...new Set(parts.flatMap((p) => (p.toUpperCase() === 'REWARDS' ? REWARD_REASONS : [p])))];
  },
  z.array(z.enum([...Object.values(REASON), ...LEDGER_EXTRA_REASONS])).min(1).max(20).optional()
);

const listLedger = {
  query: z.object({
    currency: knownCurrency.optional(),
    reason: ledgerReason,
    // The Transaction pane's Bill type (wallet.repository LEDGER_CATEGORY_SQL).
    category: z.enum(['game', 'affiliate', 'vault', 'swap', 'bonus']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict(),
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
      currency: knownCurrency,
      amount: moneyAmount,
      operation: z.enum(['credit', 'debit']),
      description: z.string().trim().min(1, 'a reason is required').max(500),
      // The operator re-authenticates for a balance change. Legacy checked this
      // too, and it stays because a hijacked admin session is the realistic
      // threat here, not a guessed password.
      transactionPassword: z.string().min(1).optional(),
      /**
       * One key per submit, generated by the admin UI. The same key again is a
       * genuine retry (double-click, network retry) and is replayed; a new key
       * is a new adjustment even with identical figures. Namespaced per staff
       * account on the server.
       */
      idempotencyKey: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/, 'letters, digits, : _ - only').optional(),
    })
    .strict(),
};

const adminBalance = {
  params: z.object({ userId }),
};

/**
 * GET /api/v1/admin/user/wallet/:userId/reconcile[?currency=INR]
 *
 * With a currency, that one balance against its ledger; without one, every
 * currency the wallet holds or has ledger rows in (it used to 500 here, the
 * service needing a currency the validator never asked for).
 */
const adminReconcile = {
  params: z.object({ userId }),
  query: z.object({ currency: knownCurrency.optional() }).strict(),
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
      // Only players with a positive balance in this coin (the site admin's Wallets filter).
      heldCurrency: knownCurrency.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .strict(),
};

const adminHistory = {
  params: z.object({ userId }),
  query: z.object({
    currency: knownCurrency.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict(),
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
      .refine((v) => KNOWN_CURRENCIES.includes(v) || isCustomCurrency(v), {
        message: `currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}, or a coin the site created`,
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
  adminReconcile,
  adminListBalances,
  adminHistory,
  // exported for reuse by other modules that move money
  moneyAmount,
  currency,
  knownCurrency,
  idempotencyKey,
};
