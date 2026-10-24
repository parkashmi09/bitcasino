'use strict';

/**
 * Rakeback — a share of the house edge, accrued from wagering and claimed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Socket-only in legacy: `C.RAKEBACK_AMOUNT` reads the accrual and
 * `C.ADD_RAKEBACK` claims it, both with no payload and no HTTP equivalent.
 *
 * The claim was four independent statements — read the accrual, credit the
 * wallet, bump the bonus counters, reset the accrual — with no transaction and
 * no row lock. Two claims arriving together both read the same balance and both
 * were paid it, and a failure between statements two and four left the player
 * paid with the accrual still claimable. There was no ledger row for any of it.
 *
 * One transaction with `SELECT … FOR UPDATE` here, and the movement goes
 * through the wallet so it lands in the player's statement.
 * ─────────────────────────────────────────────────────────────────────────
 */
module.exports = {
  name: 'rakeback',
  service: 'user',
  basePath: '/rakeback',
  models: ['core', 'extended'],
  /**
   * The two legacy events are socket-only, but a claim is a money movement and
   * a money movement should be callable without a WebSocket — support tooling,
   * a mobile client on a flaky connection, a retry after a disconnect. The HTTP
   * routes are the same two operations on the same service.
   */
  routers: {
    user: require('./routes/user.routes'),
    /**
     * Accrual, for the services that settle wagers.
     *
     * The accrual and the claim are two ends of one balance, so they live in
     * one module behind one row lock. casino-service posting the figure it
     * computed is the whole of the boundary — see `routes/internal.routes.js`.
     */
    internal: require('./routes/internal.routes'),
  },
};
