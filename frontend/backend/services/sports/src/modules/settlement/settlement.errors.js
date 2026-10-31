'use strict';

const { defineErrors } = require('@ibitplay/common');

/**
 * Every failure the settlement module can produce.
 *
 * Legacy returned `{ success: false, error: err.message }` with a 500 for all
 * of them — including "market not found" and "no open bets", which are normal
 * outcomes an operator needs to distinguish. Worse, `err.message` on an
 * unexpected fault leaked the raw Postgres error (table names, column names,
 * constraint names) straight to the browser.
 *
 * Here each case gets its real status and a stable code the admin UI can branch
 * on, and anything unexpected falls through to the shared error handler as a
 * generic 500 with the stack logged, not returned.
 */
module.exports = defineErrors('SETTLEMENT', {
  // ── Lookup ──────────────────────────────────────────────────────────
  MARKET_NOT_FOUND: {
    status: 404,
    message: 'No market found for the given match and market type',
  },
  BET_NOT_FOUND: {
    status: 404,
    message: 'Open bet not found — it may already have been settled or voided',
  },
  LEDGER_ENTRY_NOT_FOUND: {
    status: 404,
    message: 'Settlement entry not found',
  },
  NO_SETTLED_ENTRIES: {
    status: 404,
    message: 'No settled entries found for this market',
  },

  // ── Conflicts: the request is well-formed but the state says no ─────
  NO_OPEN_BETS: {
    status: 409,
    message: 'This market has no open bets to settle',
  },
  MARKET_ALREADY_SETTLED: {
    status: 409,
    message: 'This market has already been settled',
  },
  BET_ALREADY_CLOSED: {
    status: 409,
    message: 'This bet is no longer open',
  },
  ALREADY_VOIDED: {
    status: 409,
    message: 'This market has already been voided after settlement',
  },
  SETTLEMENT_IN_PROGRESS: {
    status: 409,
    message: 'Settlement is already running for this market — retry in a moment',
  },
  VOID_WINDOW_EXPIRED: {
    status: 409,
    message: 'The void window for this market has expired',
  },

  // ── Business rules ──────────────────────────────────────────────────
  SELECTION_REQUIRED: {
    status: 422,
    message: 'This market type settles per selection, so a selection name is required',
  },
  RESULT_REQUIRED: {
    status: 422,
    message: 'A winner (market result) or a run value (fancy result) is required',
  },
  PAYOUT_EXCEEDS_LIMIT: {
    status: 422,
    message: 'The calculated payout exceeds the configured maximum for a single market',
  },

  // ── Downstream ──────────────────────────────────────────────────────
  REFUND_FAILED: {
    status: 502,
    message: 'The stake refund could not be completed — no balances were changed',
  },
});
