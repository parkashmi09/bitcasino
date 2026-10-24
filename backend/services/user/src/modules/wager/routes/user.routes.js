'use strict';

const { noQuery } = require('@ibitplay/common');

const { Router } = require('express');
const { WagerService } = require('../wager.service');
const { createControllers } = require('../controllers');

/** A player checking their own wagering progress. */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new WagerService(deps) });
  const router = Router();

  router.get('/progress', noQuery(), ctrl.myProgress);
  /**
   * The rollover page's table — gap 14. One task on this platform, because it
   * has one requirement; see `getTasks` for why that is the honest shape
   * rather than a per-bonus table.
   */
  router.get('/tasks', noQuery(), ctrl.myTasks);

  return router;
};
