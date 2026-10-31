'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createActivityRecorder, requireTxnPassword } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../playerBonus.validators');
const { PlayerBonusService } = require('../playerBonus.service');

/**
 * Staff view of player bonuses — tree-scoped like every other per-player read
 * (`directory/playerScope.js`): a caller sees the players under their own tree, the house sees
 * everyone, and a player outside the tree answers 404.
 *
 *   GET  /                    the bonuses report (filters, paging, totals per status/currency)
 *   GET  /users/:userId       one player's bonuses (the player detail)
 *   POST /:id/forfeit         forfeit an active bonus — `wallet:adjust`, audited
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new PlayerBonusService(deps);
  const router = Router();
  // Gives or takes balance: the staff caller's transaction code first.
  const txnCode = requireTxnPassword({ clients });

  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });
  const canRead = auth.requireAnyPermission(PERMISSIONS.REPORTS_READ, PERMISSIONS.USERS_READ, PERMISSIONS.WALLET_READ);
  const canForfeit = auth.requirePermission(PERMISSIONS.WALLET_ADJUST);

  router.get(
    '/',
    canRead,
    validate(v.report),
    asyncHandler(async (req, res) => {
      const { limit, offset, ...filters } = req.query;
      const result = await service.report({ staff: req.staff, ...filters, limit, offset });
      // `{ rows, total, totals }`: the staff client's paged reader takes the rows and the total.
      return response.ok(res, { ...result, limit, offset });
    })
  );

  router.get(
    '/users/:userId',
    canRead,
    validate(v.userParam),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.listForPlayer({ staff: req.staff, userId: req.params.userId }))
    )
  );

  router.post(
    '/:id/forfeit',
    canForfeit,
    txnCode,
    validate(v.forfeit),
    withActivity({
      action: 'bonus.player-bonus.forfeit',
      describe: (req) => ({ targetType: 'PLAYER_BONUS', targetId: req.params.id, details: { reason: req.body?.reason ?? null } }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.forfeit({ bonusId: req.params.id, staff: req.staff, reason: req.body?.reason }))
    )
  );

  return router;
};
