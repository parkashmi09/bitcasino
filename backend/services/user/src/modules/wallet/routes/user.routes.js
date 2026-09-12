'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../wallet.validators');
const { WalletService } = require('../wallet.service');
const { createUserController } = require('../controllers/user.controller');

/**
 * A player's own wallet. Read-only by design.
 *
 * Mounted at `/api/v1/user/wallet` behind `authenticate()` + `requireActive()`,
 * applied by the module loader.
 */
module.exports = function userRoutes(deps) {
  const service = new WalletService(deps);
  const ctrl = createUserController({ service });

  const router = Router();

  router.get('/balances', ctrl.balances);

  /**
   * @legacy GET /user/api/balance?uid=&coin_symbol=
   *
   * One currency. Legacy read the player from the query string on an
   * unauthenticated route, and built the column name by interpolating
   * `coin_symbol` into the SELECT — guarded only by a hand-maintained array
   * that had drifted from the `credits` columns. The player comes from the
   * token, and the currency is resolved through the wallet's allow-list.
   */
  router.get('/balances/:currency', validate(v.balanceOf), ctrl.balanceOf);
  router.get('/history', validate(v.listHistory), ctrl.history);
  router.get('/ledger', validate(v.listLedger), ctrl.ledger);

  return router;
};
