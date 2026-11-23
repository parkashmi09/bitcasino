'use strict';

const { Router } = require('express');
const { response, asyncHandler, entitlements, noQuery, noBody, validate, z, createRateLimiter } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const { QuestsService, DAILY_QUESTS } = require('../quests.service');

const claimParams = { params: z.object({ key: z.enum(DAILY_QUESTS.map((q) => q.key)) }) };

/** The signed-in player's quests. */
module.exports = function userRoutes(deps) {
  const service = new QuestsService(deps);
  const router = Router();
  const claimLimiter = createRateLimiter({
    name: 'quest-claim',
    windowMs: 60_000,
    max: 10,
    enabled: deps.config?.RATE_LIMIT_ENABLED !== false,
  });

  // The owner's "Challenges / Quest Hub" feature, and no promotions for an agent's player.
  router.use(entitlements.requireFeature('challenges'));
  router.use(denyAgentPlayer('promotions'));

  router.get('/', noQuery(), asyncHandler(async (req, res) => response.ok(res, await service.forPlayer(req.user.id))));

  router.post(
    '/:key/claim',
    noBody(),
    claimLimiter,
    validate(claimParams),
    asyncHandler(async (req, res) => response.ok(res, await service.claim(req.user.id, req.params.key)))
  );

  return router;
};
