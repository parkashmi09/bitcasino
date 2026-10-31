'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../swap.validators');
const { SwapService } = require('../swap.service');
const { createControllers } = require('../controllers');

/** Swap history across all players, for support and reconciliation. */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const service = new SwapService(deps);
  const ctrl = createControllers({ service });

  const router = Router();

  router.get('/history', auth.requirePermission(PERMISSIONS.WALLET_READ), validate(v.adminHistory), ctrl.adminHistory);
  router.get('/history/:userId', auth.requirePermission(PERMISSIONS.WALLET_READ), validate({ ...v.userParam, ...v.listHistory }), ctrl.adminUserHistory);

  return router;
};
