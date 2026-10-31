'use strict';

const { Router } = require('express');
const { noQuery } = require('@ibitplay/common');

const { MedalsService } = require('../medals.service');
const { createUserController } = require('../controllers/user.controller');

/**
 * `GET /api/v1/user/medals` — the caller's full medal catalogue: every medal,
 * locked or not, with its rule, progress, unlock date and holder count, plus
 * `medalCount` for the profile header.
 *
 * No `denyAgentPlayer`: medals are cosmetic (nothing is paid), so they are not
 * a promotion — an agent-tree player earns them like anyone else.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createUserController({ service: new MedalsService(deps) });
  const router = Router();
  router.get('/', noQuery(), ctrl.mine);
  return router;
};
