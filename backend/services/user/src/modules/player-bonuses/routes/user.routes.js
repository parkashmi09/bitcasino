'use strict';

const { Router } = require('express');
const { response, asyncHandler, noQuery } = require('@ibitplay/common');

const { PlayerBonusService } = require('../playerBonus.service');

/**
 * The player's own bonus balance: what is locked, how much more to wager for each bonus, and
 * the recent history. Not behind the `bonus` feature: the first-deposit and spin bonuses are not
 * either, and the wallet must say what is (and is not) withdrawable whenever a bonus exists.
 * An agent-tree player simply has none.
 */
module.exports = function userRoutes(deps) {
  const service = new PlayerBonusService(deps);
  const router = Router();

  router.get('/', noQuery(), asyncHandler(async (req, res) => response.ok(res, await service.summary(req.user.id))));
  /** hash.game: claim what the locked bonus has unlocked so far — any time, no expiry. */
  router.post('/claim', noQuery(), asyncHandler(async (req, res) => response.ok(res, await service.claimUnlocked(req.user.id))));

  return router;
};
