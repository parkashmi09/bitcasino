'use strict';

/**
 * Place bet, current bets, exposure — mssports API group 2.
 *
 *   controllers/   sportbetscontroller (placeBet, combined slip, cancel, fancy bets),
 *                  userExposureController
 *   buffer/        the server-side bet buffer: betBuffer → (wait + live checks, fail-closed) →
 *                  placeBet; betBufferRules, liveOdds (shared poller), betInflight (client_ref)
 *   services/      ExposureService, BetLockService
 *   sockets/       socketHandler — the player's balance room (see `sockets.js`)
 *
 * Placement debits `Wallets.cash` and writes `user_exposures`, `total_exposures` and
 * `debit_ledger` in one transaction, in schema `mssports`.
 *
 * Routes are mssports' own, under `/api/v1/sports/user`; the gateway keeps `/api/user/...`.
 */
module.exports = {
  name: 'bets',
  service: 'sports',
  basePath: '/user',

  routers: {
    public: require('./routes/public.routes'),
  },
};
