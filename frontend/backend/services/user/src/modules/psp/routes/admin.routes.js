'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../psp.validators');
const { PspService } = require('../psp.service');
const { createControllers } = require('../controllers');

/** Support looking up any player's provider transaction. */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const ctrl = createControllers({ service: new PspService(deps) });
  const router = Router();

  router.get('/:provider/status/:reference', auth.requirePermission(PERMISSIONS.DEPOSITS_READ), validate(v.statusLookup), ctrl.status);

  return router;
};
