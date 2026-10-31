'use strict';

const { Router } = require('express');
const { response, asyncHandler, createRateLimiter, noBody, noQuery } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const { LossBonusService } = require('../lossBonus.service');

/**
 *   GET  /api/v1/user/loss-bonus         the terms, the last period's net loss and its bonus
 *   POST /api/v1/user/loss-bonus/claim   the player confirmed: pay it (once per period)
 */
module.exports = function userRoutes(deps) {
  const service = new LossBonusService(deps);
  const router = Router();
  // Agent-tree players (owner at staff level 4–6) have no promotions.
  router.use(denyAgentPlayer('promotions'));

  const claimLimiter = createRateLimiter({
    name: 'loss-bonus-claim',
    windowMs: 60_000,
    max: 10,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  router.get(
    '/',
    noQuery(),
    asyncHandler(async (req, res) => response.ok(res, await service.summary(req.user.id)))
  );

  router.post(
    '/claim',
    noBody(),
    claimLimiter,
    asyncHandler(async (req, res) => response.ok(res, await service.claim(req.user.id)))
  );

  return router;
};
