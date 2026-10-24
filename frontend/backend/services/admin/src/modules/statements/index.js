'use strict';

/**
 * Account statements — the "hisab".
 *
 * The plain question every account holder asks: what did I have, what was
 * done, what did the betting do, and what do I have now. One builder answers
 * it for an agent (their own wallet, plus the downline's play as profit) and
 * for a player (every source that moves their wallet), and one renderer turns
 * either into a PDF — so print and screen cannot disagree.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS IS THE BEST-WRITTEN CODE IN THE LEGACY REPOSITORY
 *
 * `report/statement.js` is careful in ways the rest of the codebase is not:
 * it checks the hierarchy on every path, it anchors the running balance on the
 * live wallet and derives backwards so the last row of an up-to-date period
 * equals the real balance, and it surfaces the lifetime drift it cannot
 * explain as `unexplained` rather than smearing it across the rows. The port
 * keeps all of that, including the reasoning, which is repeated where it
 * matters.
 *
 * Two things are changed.
 *
 * ── 1. THE MONEY IS EXACT ────────────────────────────────────────────────
 *
 *     const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
 *     const round2 = (n) => Math.round((num(n)) * 100) / 100;
 *
 * Every figure went through those two: opening balance, each row's amount, the
 * running total, the P&L. `round2` after every step of a running sum does not
 * remove the error, it accumulates it — a statement over a few thousand rows
 * closes a few paise away from the wallet for no reason the reader can trace,
 * and `unexplained` then reports drift that is arithmetic rather than data.
 * Minor units throughout here.
 *
 * ── 2. SPORTS P&L IS FILTERED BY REASON ──────────────────────────────────
 *
 * The statement read EVERY row of `credits_ledger` and labelled it "Sports bet
 * won" or "Sports bet lost". In legacy that was sound: the settlement worker
 * was the only writer. It is no longer true — this port's crypto deposits,
 * bonuses, gift cards, swaps and PSP settlements all write ledger rows. Read
 * wholesale, a deposit becomes a bet won and the player's sports P&L is
 * nonsense. The sports reasons are asked for by name.
 *
 * ── ON THE PDF ───────────────────────────────────────────────────────────
 *
 * Legacy had two renderers, 380 and 147 lines, drawing the same numbers in
 * different code. One here, over the payload the JSON endpoints return, so a
 * disagreement between the download and the screen is not expressible.
 */
module.exports = {
  name: 'statements',
  service: 'admin',
  basePath: '/statements',
  models: ['admin', 'core', 'payments', 'sports', 'casino', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
