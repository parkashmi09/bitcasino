'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../catalogue.validators');
const { CatalogueService } = require('../catalogue.service');
const { createControllers } = require('../controllers');

/**
 * Which sports are on the board.
 *
 * The only read here that a player needs — the list, and only the enabled ones
 * by default. The WRITES that legacy served from the same router are on the
 * admin router, behind a permission; they had none at all.
 */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: new CatalogueService(deps) });
  const router = Router();

  router.get('/sports', validate(v.listSports), ctrl.listSports);

  return router;
};
