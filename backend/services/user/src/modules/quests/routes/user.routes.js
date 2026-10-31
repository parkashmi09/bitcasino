'use strict';

const { Router } = require('express');
const { response, asyncHandler, entitlements, noQuery } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const { QuestsService } = require('../quests.service');

/** The signed-in player's quests. */
module.exports = function userRoutes(deps) {
  const service = new QuestsService(deps);
  const router = Router();

  // The owner's "Challenges / Quest Hub" feature, and no promotions for an agent's player.
  router.use(entitlements.requireFeature('challenges'));
  router.use(denyAgentPlayer('promotions'));

  router.get('/', noQuery(), asyncHandler(async (req, res) => response.ok(res, await service.forPlayer(req.user.id))));

  return router;
};
