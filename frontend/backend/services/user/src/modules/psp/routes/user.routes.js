'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../psp.validators');
const { PspService } = require('../psp.service');
const { createControllers } = require('../controllers');

/** A player polling their own deposit. Ownership is checked in the service. */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new PspService(deps) });
  const router = Router();

  router.get('/:provider/status/:reference', validate(v.statusLookup), ctrl.myStatus);

  return router;
};
