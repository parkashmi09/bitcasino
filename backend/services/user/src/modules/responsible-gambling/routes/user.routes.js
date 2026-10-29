'use strict';

const { Router } = require('express');
const { validate, noBody, noQuery } = require('@ibitplay/common');

const v = require('../responsible.validators');
const { ResponsibleService } = require('../responsible.service');
const { createControllers } = require('../controllers');

/**
 * The player's own breaks and limits — the player site's `/responsible-gambling` tabs.
 *
 * Every route is the caller's own; none takes a player id. Nothing here can shorten a break or
 * lift a limit at once: the writes only ever add protection (see migration 163).
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new ResponsibleService(deps) });
  const router = Router();

  router.get('/', noQuery(), ctrl.overview);
  router.post('/self-exclusions/cooldown', validate(v.cooldown), ctrl.startCooldown);
  router.post('/self-exclusions', validate(v.selfExclusion), ctrl.startBreak);
  router.post('/limits', validate(v.createLimit), ctrl.createLimit);
  router.post('/limits/:id/remove', noBody(), validate(v.limitParam), ctrl.requestLimitRemoval);

  return router;
};
