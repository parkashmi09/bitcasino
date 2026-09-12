'use strict';

const { defineErrors } = require('@ibitplay/common');

/**
 * Every failure the wallet can produce.
 *
 * `INSUFFICIENT_FUNDS` is the one that matters most: it has to reach the player
 * as `INSUFFICIENT_FUNDS` even though it travels casino -> user-service and back
 * over HTTP. `ServiceClient` preserves upstream codes for exactly this reason —
 * a 402 that arrives as a generic 503 tells the player the site is broken when
 * in fact they simply need to deposit.
 */
module.exports = defineErrors('WALLET', {
  // ── Funds ───────────────────────────────────────────────────────────
  INSUFFICIENT_FUNDS: {
    status: 402,
    message: 'Insufficient balance for this transaction',
  },
  NEGATIVE_AMOUNT: {
    status: 422,
    message: 'Amount must be greater than zero',
  },
  AMOUNT_TOO_LARGE: {
    status: 422,
    message: 'Amount exceeds the maximum permitted for a single transaction',
  },

  // ── Identity ────────────────────────────────────────────────────────
  WALLET_NOT_FOUND: {
    status: 404,
    message: 'No wallet exists for this player',
  },
  UNSUPPORTED_CURRENCY: {
    status: 422,
    message: 'This currency is not supported',
  },

  // ── Idempotency and replay ──────────────────────────────────────────
  IDEMPOTENCY_KEY_REQUIRED: {
    status: 422,
    message: 'An Idempotency-Key is required for this operation',
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    message: 'This idempotency key was already used with different parameters',
  },

  // ── Reversal ────────────────────────────────────────────────────────
  LEDGER_ENTRY_NOT_FOUND: {
    status: 404,
    message: 'The referenced transaction does not exist',
  },
  ALREADY_ROLLED_BACK: {
    status: 409,
    message: 'This transaction has already been rolled back',
  },
  ROLLBACK_WOULD_GO_NEGATIVE: {
    status: 409,
    message: 'Cannot roll back: the player has already spent these funds',
  },

  // ── Transfers ───────────────────────────────────────────────────────
  SAME_ACCOUNT_TRANSFER: {
    status: 422,
    message: 'Cannot transfer to the same account',
  },

  // ── State ───────────────────────────────────────────────────────────
  WALLET_LOCKED: {
    status: 423,
    message: 'This wallet is locked. Contact support.',
  },

  // ── tipping and rain, from the socket surface ──────────────────────────

  CURRENCY_NOT_TIPPABLE: {
    status: 422,
    // `nc` is play money. Moving it between accounts would let players trade
    // something the platform prints.
    message: 'That currency cannot be sent to another player',
  },

  TIP_TOO_SMALL: {
    status: 422,
    /**
     * Legacy had two contradictory floors in a row: the check was
     * `amount <= 0.0000003` and the message said `0.00000050`, so amounts
     * between the two were accepted while being told they were not.
     */
    message: 'That amount is below the minimum',
  },

  TIP_TARGET_NOT_FOUND: {
    status: 404,
    // One code for "no such player" and "closed account" — a tip box that
    // distinguishes them is a username oracle.
    message: 'No such player',
  },

  TIP_TO_SELF: { status: 422, message: 'You cannot tip yourself' },

  RAIN_PLAYER_COUNT: {
    status: 422,
    // Legacy had no ceiling: `amount * players` with `players` from the
    // message, and a rain is N separate transfers.
    message: 'That is more players than one rain may reach',
  },

  RAIN_NOT_ENOUGH_PLAYERS: {
    status: 422,
    message: 'Not enough recent chatters to rain on',
  },

  UNKNOWN_ROOM: {
    status: 422,
    // Legacy built `"chat_" + _.lowerCase(room)` from the message.
    message: 'No such chat room',
  },
});
