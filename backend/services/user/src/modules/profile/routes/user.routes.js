'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, noQuery } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../profile.validators');
const { ProfileService } = require('../profile.service');
const { ProfileStatsService } = require('../profileStats.service');
const { ProfileTurnoverService } = require('../profileTurnover.service');
/**
 * Changing the address spends a verified code, and issuance and proof both
 * live in the email module. Imported directly rather than injected, which is
 * what `profile/sockets.js` already does for the same reason: the two modules
 * are in the same service and neither is a boundary.
 */
const { EmailService } = require('../../email/email.service');
const { createControllers } = require('../controllers');

module.exports = function userRoutes(deps) {
  const service = new ProfileService(deps);
  const emails = new EmailService(deps);
  const ctrl = createControllers({ service, emails });

  const router = Router();

  router.get('/', noQuery(), ctrl.get);
  /**
   * The caller's own lifetime play: wagered (USD + per currency), bets, wins,
   * win rate, biggest win, top games/providers, first/last bet. No
   * `denyAgentPlayer`: wagered is play, not a promotion. Cached 60 s per
   * player inside the service (one instance per router, so one cache).
   */
  const stats = new ProfileStatsService(deps);
  router.get('/stats', noQuery(), asyncHandler(async (req, res) => response.ok(res, await stats.forPlayer(req.user.id))));
  /**
   * The profile's Turnover block: total wager, total deposit, and the wagering requirement the
   * platform really enforces (active bonuses) with progress. In `?currency=` (the player's
   * "View in"), else the reward currency. Agent-tree players have no deposits and no bonuses of
   * their own, so — like the reference site — the block is not theirs (`deposit` capability).
   */
  const turnover = new ProfileTurnoverService(deps);
  router.get(
    '/turnover',
    denyAgentPlayer('deposit'),
    validate(v.turnoverQuery),
    asyncHandler(async (req, res) =>
      response.ok(res, await turnover.forPlayer(req.user.id, { currency: req.query.currency }))
    )
  );
  router.put('/', denyAgentPlayer('profileEdit'), validate(v.updateProfile), ctrl.update);
  /** One of Admin → Avatars' pictures, refused above the player's VIP level (`AVATAR_LOCKED`). */
  router.post('/avatar', denyAgentPlayer('profileEdit'), validate(v.setAvatar), ctrl.setAvatar);
  // A referral link is affiliate business — not for agent-tree players.
  router.get('/referral', noQuery(), denyAgentPlayer('promotions'), ctrl.referral);
  /**
   * @legacy SOCKET `C.EDIT_ACCOUNT` (the email arm)
   *
   * `ProfileService.changeEmail` has existed and been correct since the port;
   * it simply had no route. `PUT /profile` accepts `username`, `country` and
   * `avatar` and nothing else, so this is its own path rather than a fourth
   * key there — the operation needs a second factor and the others do not.
   */
  router.post('/change-email', validate(v.changeEmail), ctrl.changeEmail);

  return router;
};
