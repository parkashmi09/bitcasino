'use strict';

/**
 * The operator dashboard — headline figures and today's activity.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * SIX OF THESE NINE ROUTES WERE UNAUTHENTICATED
 *
 *     server.get('/total-deposits',     async (req, res) => { …
 *     server.get('/total-withdrawals',  async (req, res) => { …
 *     server.get('/today-deposits',     async (req, res) => { …
 *     server.get('/today-withdrawals',  async (req, res) => { …
 *     server.get('/today-transactions', async (req, res) => { …
 *     server.get('/api/members/:uid',   async (req, res) => { …
 *
 * No middleware on any of them. `/today-deposits` is `SELECT * FROM deposits
 * WHERE DATE(date) = CURRENT_DATE` — every column of every deposit made today,
 * wallet addresses and transaction ids included, to anyone who could reach the
 * port. `/total-deposits` and `/total-withdrawals` gave away the platform's
 * lifetime volume.
 *
 * Only `/api/admin/dashboard` and `/api/admin/user-stats` had `protectStaff`.
 *
 * ── `/today-transactions` HAS NEVER WORKED ───────────────────────────────
 *
 *     const deposits    = await pg.query(`…`);
 *     const withdrawals = await pool.query(`…`);
 *                               ^^^^
 *
 * `pool` is not defined anywhere in `index.js`. It appears three times and is
 * declared nowhere — the file uses `pg`. Reading an undeclared identifier
 * throws `ReferenceError`, so this route has answered 500 on every request
 * since it was written. (The other two uses are `getPlayerBalance` and
 * `updatePlayerBalance` in the seamless casino block, which throw the same way.)
 *
 * ── `/total-deposits` WAS AN N+1 OVER THE ENTIRE HISTORY ─────────────────
 *
 *     const result = await pg.query('SELECT amount, coin FROM deposits');
 *     for (const deposit of result.rows) {
 *       totalDeposits += await convertToUSDT(deposit.amount, deposit.coin);
 *     }
 *
 * Every deposit ever made, one at a time, on the single shared connection —
 * unauthenticated. One request holds the platform's only database connection
 * for as long as the loop runs.
 *
 * ── AND THE FIGURES THEMSELVES ───────────────────────────────────────────
 *
 * Two problems, both of which make the numbers wrong rather than missing:
 *
 * 1. LIFETIME TOTALS ARE VALUED AT TODAY'S EXCHANGE RATE. The dashboard joins
 *    `exchangerate` with no time dimension, so a BTC deposit from three years
 *    ago is counted at today's BTC price. "Total deposits" therefore moves —
 *    retroactively, for the whole history — every time the rate table is
 *    updated. See `dashboard.constants.js`.
 *
 * 2. THE JOIN IS INNER. A deposit in a currency with no row in `exchangerate`
 *    is silently dropped from the total rather than counted or reported. The
 *    marketing panel documents this choice deliberately; the dashboard makes
 *    the same one silently. Here the excluded volume is COUNTED and returned
 *    alongside, so a total that is missing something says so.
 */
module.exports = {
  name: 'dashboard',
  service: 'admin',
  basePath: '/dashboard',
  models: ['admin', 'core', 'payments', 'casino', 'sports', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
