'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../xCasino.validators');
const { XCasinoService } = require('../xCasino.service');
const { createControllers } = require('../controllers');

/**
 * The provider's callbacks.
 *
 * `public` is the AUDIENCE — these carry no staff or player guard because the
 * provider holds neither. The SIGNATURE is the authentication, and it is
 * checked in one place (`controllers/index.js`) for every route here, so a
 * route added later cannot forget it.
 *
 * That is the difference from legacy, where each of the six handlers called
 * `verifyHash` itself — and where the signature covered `command` and
 * `request_timestamp` but not `data`, so it authenticated the fact that
 * somebody once knew the secret rather than the request in front of it.
 */
module.exports = function publicRoutes(deps) {
  const { config, logger } = deps;
  const ctrl = createControllers({ service: new XCasinoService(deps), config, logger });

  const router = Router();

  /** @legacy POST /api/casino/authenticate */
  router.post('/authenticate', validate(v.authenticate), ctrl.authenticate);

  /** @legacy POST /api/casino/balance */
  router.post('/balance', validate(v.balance), ctrl.balance);

  /** @legacy POST /api/casino/changebalance */
  router.post('/changebalance', validate(v.changeBalance), ctrl.changeBalance);

  /** @legacy POST /api/casino/status */
  router.post('/status', validate(v.status), ctrl.status);

  /** @legacy POST /api/casino/cancel */
  router.post('/cancel', validate(v.cancel), ctrl.cancel);

  return router;
};
