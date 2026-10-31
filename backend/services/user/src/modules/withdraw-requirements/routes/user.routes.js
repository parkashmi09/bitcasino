'use strict';

const { Router } = require('express');
const { response, asyncHandler, validate } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const { createWithdrawRequirements } = require('../withdrawRequirements');
const v = require('../withdrawRequirements.validators');

/**
 * `GET /api/v1/user/withdrawals/requirements` — what this site requires before a withdrawal,
 * and what the caller is still missing. Shape: `withdrawRequirements.evaluate`.
 *
 * Agent-tree players have no withdrawal rail: 403 WITHDRAW_NOT_FOR_AGENT_USERS, as every rail.
 * Query: only `currency` (strict, any other key is a 422): with it `cap` is that currency's
 * deposit-cap block, without it one block per currency the player has used. No cache.
 */
module.exports = function userRoutes(deps) {
  const requirements = createWithdrawRequirements(deps);
  const router = Router();

  router.get(
    '/',
    denyAgentPlayer('withdraw'),
    validate(v.read),
    asyncHandler(async (req, res) => {
      res.set('cache-control', 'no-store');
      return response.ok(res, await requirements.evaluate(req.user.id, { currency: req.query.currency }));
    })
  );

  return router;
};
