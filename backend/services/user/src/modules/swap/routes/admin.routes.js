'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree, SWAP_NOT_FOR_AGENTS } = require('@ibitplay/auth');

const v = require('../swap.validators');
const { SwapService } = require('../swap.service');
const { createControllers } = require('../controllers');

/** Swap history across all players, for support and reconciliation. */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const service = new SwapService(deps);
  const ctrl = createControllers({ service });

  const router = Router();

  // Swap admin is house-only, like the vault: SUPER_MASTER / MASTER / AGENT
  // (and their executives) are refused every route — SWAP_NOT_FOR_AGENTS.
  // Their players cannot swap either (SWAP_NOT_FOR_AGENT_USERS).
  router.use(denyAgentTree({ code: SWAP_NOT_FOR_AGENTS, message: 'Swap is not available to agent accounts' }));

  router.get('/history', auth.requirePermission(PERMISSIONS.WALLET_READ), validate(v.adminHistory), ctrl.adminHistory);
  router.get('/fee-history', auth.requirePermission(PERMISSIONS.WALLET_READ), validate(v.feeHistory), ctrl.feeHistory);
  router.get('/summary', auth.requirePermission(PERMISSIONS.WALLET_READ), validate(v.adminSummary), ctrl.adminSummary);
  router.get('/fee', auth.requirePermission(PERMISSIONS.WALLET_READ), ctrl.getFee);
  router.put('/fee', auth.requirePermission(PERMISSIONS.CONFIG_WRITE), validate(v.setFee), ctrl.setFee);
  router.get('/history/:userId', auth.requirePermission(PERMISSIONS.WALLET_READ), validate({ ...v.userParam, ...v.listHistory }), ctrl.adminUserHistory);

  return router;
};
