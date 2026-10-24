'use strict';

const { Router } = require('express');
const { validate, entitlements, noQuery } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

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

  // Not in the owner's plan: every player route here answers 403 NOT_ENTITLED.
  router.use(entitlements.requireFeature('swap'));

  // Agent-tree players (owner at staff level 4–6) cannot swap: the quote, the
  // swap screen's balances and the swap itself answer 403
  // SWAP_NOT_FOR_AGENT_USERS. Their HISTORY stays readable on purpose — it is
  // a read of their own past rows, moves no money, and keeps swaps made before
  // the rule visible. `SwapService.swap` asserts the same capability, so the
  // SUBMIT_NEW_SWAP socket is covered too.
  const noAgentPlayers = denyAgentPlayer('swap');

  router.get('/balances', noQuery(), noAgentPlayers, ctrl.balances);
  router.get('/estimate', noAgentPlayers, validate(v.estimate), ctrl.estimate);
  router.post('/', noAgentPlayers, validate(v.swap), ctrl.swap);
  router.get('/history', validate(v.listHistory), ctrl.history);

  return router;
};
