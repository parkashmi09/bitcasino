'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../tip.validators');
const { TipService } = require('../tip.service');
const { createControllers } = require('../controllers');

/**
 * The staff tips report. Read-only, and scoped to the caller's tree: a tip
 * shows when its sender OR its receiver is a player the caller may see
 * (`directory/playerScope`), so a sub-admin never sees another tree's tips.
 */
module.exports = function adminRoutes(deps) {
  const ctrl = createControllers({ service: new TipService(deps) });
  const router = Router();

  router.get('/list', deps.auth.requirePermission(PERMISSIONS.REPORTS_READ), validate(v.adminList), ctrl.adminList);

  return router;
};
