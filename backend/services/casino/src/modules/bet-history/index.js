'use strict';

/**
 * Casino transaction reporting, across all four places a bet can live.
 *
 *   THE STAFF SCOPE CAME FROM A RAW `x-staff-id` HEADER on routes with no
 *   authentication at all. `x-staff-id: 1` returned every transaction on the
 *   platform, plus the rows with no owner, to anyone who sent it.
 *
 *   FIVE HANDLERS EACH DEFINED "WIN" DIFFERENTLY. A zero-profit round was a
 *   `BET` in one report, neither a win nor a loss in another, and a `bet` in a
 *   third — so the totals from one endpoint never reconciled against another's.
 *
 *   IT FETCHED HISTORY OVER HTTP FROM ANOTHER DEPLOYMENT OF ITSELF, at a
 *   hard-coded absolute URL, synchronously inside a paginated report, and
 *   swallowed the failure — so a slow host made the report slow and a dead one
 *   silently dropped a whole category of transactions from the page.
 *
 *   THE LEADERBOARD ADDED UP DIFFERENT CURRENCIES. A USDT stake and an INR
 *   stake were summed into one figure and players ranked by the result.
 *
 *   `GET /live-bets` ANSWERED WITH `SELECT *`, putting every player's id and
 *   every column of their row on a public page.
 */
module.exports = {
  name: 'bet-history',
  service: 'casino',
  basePath: '/bet-history',
  models: ['casino', 'core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
    /**
     * Bet reads for user-service's socket transport. `bets` is a casino table
     * and user-service does not load the domain — see `internal.routes.js`.
     */
    internal: require('./routes/internal.routes'),
  },
};
