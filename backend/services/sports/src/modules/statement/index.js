'use strict';

/**
 * The player's account statement — mssports API group 3, `/api/user` part.
 *
 *   controllers/   UserStatementController
 *   services/      UserStatementService (reads `point_ledger`, one row per market),
 *                  StatementBuilder
 *
 * Routes are mssports' own, under `/api/v1/sports/user`; the gateway keeps `/api/user/...`.
 */
module.exports = {
  name: 'statement',
  service: 'sports',
  basePath: '/user',

  routers: {
    public: require('./routes/public.routes'),
  },
};
