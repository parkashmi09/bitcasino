'use strict';

const { Router } = require('express');
const { validate, noQuery } = require('@ibitplay/common');

const v = require('../responsible.validators');
const { PERMISSION } = require('../responsible.constants');
const { ResponsibleService } = require('../responsible.service');
const { createControllers } = require('../controllers');

/**
 * A player's breaks and limits for support — read-only. Staff cannot lift a player's own
 * self-exclusion or limit from here; that is deliberate.
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const ctrl = createControllers({ service: new ResponsibleService(deps) });
  const router = Router();

  router.get('/:userId', auth.requirePermission(PERMISSION.READ), noQuery(), validate(v.userParam), ctrl.forStaff);

  return router;
};
