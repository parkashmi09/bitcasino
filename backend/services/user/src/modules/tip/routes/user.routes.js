'use strict';

const { Router } = require('express');
const { validate, noQuery, entitlements, refuseCustomCurrencies } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../tip.validators');
const { TipService } = require('../tip.service');
const { createControllers } = require('../controllers');

/**
 * A player's tips. The sender is ALWAYS the token's player — no route here
 * reads a user id from the request.
 *
 * Only sending and the recipient picker need the `tips` entitlement. The
 * history and the player's own receive switch stay reachable when the owner
 * switches tips off, so past tips remain visible and an opt-out still works.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new TipService(deps) });
  const router = Router();

  // Tips move only built-in coins: a custom (site) coin is refused with
  // CURRENCY_NOT_SUPPORTED_FOR_TIPS before the validator's vaguer 400.
  router.use(refuseCustomCurrencies('TIPS'));

  // Not in the owner's plan: these answer 403 NOT_ENTITLED.
  const inPlan = entitlements.requireFeature('tips');

  // Agent-tree players cannot SEND (TIPS_NOT_FOR_AGENT_USERS); they may still
  // receive, and read their history. `TipService.send` asserts it again.
  router.post('/send', inPlan, denyAgentPlayer('tips'), validate(v.send), ctrl.send);
  router.get('/users', inPlan, validate(v.users), ctrl.users);

  router.get('/settings', noQuery(), ctrl.settings);
  router.patch('/settings', validate(v.updateSettings), ctrl.updateSettings);
  router.get('/history', validate(v.history), ctrl.history);

  return router;
};
