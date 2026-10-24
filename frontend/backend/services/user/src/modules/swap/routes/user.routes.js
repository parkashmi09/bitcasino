'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../swap.validators');
const { SwapService } = require('../swap.service');
const { createControllers } = require('../controllers');

/**
 * Player swap routes.
 *
 * Every one of these took a `uid` from the request in legacy, unauthenticated.
 * Here the loader requires a player token and the uid comes from it, so a
 * player can only read and move their own funds.
 */
module.exports = function userRoutes(deps) {
  const service = new SwapService(deps);
  const ctrl = createControllers({ service });

  const router = Router();

  router.get('/balances', ctrl.balances);
  router.get('/estimate', validate(v.estimate), ctrl.estimate);
  router.post('/', validate(v.swap), ctrl.swap);
  router.get('/history', validate(v.listHistory), ctrl.history);

  return router;
};
