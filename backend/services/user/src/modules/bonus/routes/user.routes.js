'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

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

  router.get('/', ctrl.overview);
  router.get('/history', validate(v.myPaging), ctrl.history);
  router.get('/record', ctrl.myRecord);
  router.get('/games', ctrl.myBonusGame);
  router.get('/events', validate(v.myPaging), ctrl.myEvents);
  router.get('/codes', validate(v.myCodes), ctrl.myCodes);

  router.post('/claim/:type', validate(v.claimType), ctrl.claim);
  router.post('/redeem', validate(v.redeem), ctrl.redeem);

  return router;
};
