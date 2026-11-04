'use strict';

const { Router } = require('express');
const { response, asyncHandler } = require('@ibitplay/common');

const { FirstDepositBonusService } = require('../firstDepositBonus.service');

/**
 * `GET /user/bonus/first-deposit` — the first-deposit bonus terms (USD tiers)
 * and whether THIS player can still get it.
 *
 * Public with an optional session, so the deposit dialog and a signed-out
 * promo page read the same thing: a visitor gets the terms with
 * `eligible: false`; a signed-in player also gets `eligible` and `claimed`.
 * An agent-tree player is answered (eligible: false), not refused, so the UI
 * needs no special case. Mounted before the player router, which would
 * otherwise 401 the anonymous read.
 */
module.exports = function publicRoutes(deps) {
  const service = new FirstDepositBonusService(deps);
  const router = Router();
  const withOptionalSession = deps.auth.authenticate({ optional: true });

  router.get(
    '/first-deposit',
    withOptionalSession,
    asyncHandler(async (req, res) => {
      const overview = await service.overview({ userId: req.user?.id ?? null });
      // rainbet: `hasDeposited` for a signed-in caller (the push prompt's after-first-deposit trigger).
      return response.ok(res, req.user ? { ...overview, hasDeposited: await service.hasDeposited(req.user.id) } : overview);
    })
  );

  return router;
};
