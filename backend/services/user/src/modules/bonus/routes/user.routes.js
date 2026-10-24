'use strict';

const { Router } = require('express');
const { validate, entitlements, noBody, noQuery } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../bonus.validators');
const { BonusService } = require('../bonus.service');
const { createControllers } = require('../controllers');

/**
 * A player's own bonuses.
 *
 * Legacy authenticated these with `checkRole`, which read a `role-key` header
 * and looked it up in `roles_keys` — ONE static key per role, shared by every
 * client. Holding it made you "a user", not "this user", and the player was
 * then named by a `userid` query parameter. Anyone with the app's key could
 * read and claim on anyone's behalf.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new BonusService(deps) });
  const router = Router();

  // Not in the owner's plan: every route here answers 403 NOT_ENTITLED (docs/OWNER-PANEL.md §4).
  router.use(entitlements.requireFeature('bonus'));
  // After the plan check: agent-tree players (owner at staff level 4–6) have no promotions.
  router.use(denyAgentPlayer('promotions'));

  router.get('/', noQuery(), ctrl.overview);
  router.get('/history', validate(v.myPaging), ctrl.history);
  router.get('/record', noQuery(), ctrl.myRecord);
  router.get('/games', noQuery(), ctrl.myBonusGame);
  router.get('/events', validate(v.myPaging), ctrl.myEvents);
  router.get('/codes', validate(v.myCodes), ctrl.myCodes);

  router.post('/claim/:type', noBody(), validate(v.claimType), ctrl.claim);
  router.post('/redeem', validate(v.redeem), ctrl.redeem);

  return router;
};
