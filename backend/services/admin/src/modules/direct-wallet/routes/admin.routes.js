'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS, canIssueFunds } = require('@ibitplay/auth');

const v = require('../directWallet.validators');
const { DirectWalletService } = require('../directWallet.service');

/** Login wala staff — owner hai ya nahi (`canIssueFunds`). */
const actorFrom = (req) => ({
  id: req.staff.id,
  executiveId: req.staff.executiveId ?? null,
  canIssueFunds: canIssueFunds(req.staff),
});

/**
 * Direct User Wallet (admin-structure.zip ka "Wallet" page) — sirf Super Admin.
 *
 *   GET  /admin/direct-wallet/currencies               currencies + 1 unit = kitne INR
 *   GET  /admin/direct-wallet/users                    direct users + har currency ka balance
 *   POST /admin/direct-wallet/adjust                   credit / debit (owner ke Direct User wallet se)
 *   GET  /admin/direct-wallet/users/:userId/history    ek user ki wallet history
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new DirectWalletService(deps);
  const router = Router();
  const ownerOnly = auth.requirePermission(PERMISSIONS.WALLET_ADJUST);

  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });

  router.get(
    '/currencies',
    ownerOnly,
    validate(v.currencies),
    asyncHandler(async (req, res) => response.ok(res, await service.currencies({ actor: actorFrom(req) })))
  );

  router.get(
    '/users',
    ownerOnly,
    validate(v.users),
    asyncHandler(async (req, res) => {
      const { limit, offset, search } = req.query;
      const result = await service.listUsers({ actor: actorFrom(req), limit, offset, search });
      return response.paginated(res, result.rows, { page: Math.floor(offset / limit) + 1, limit, total: result.total });
    })
  );

  router.post(
    '/adjust',
    ownerOnly,
    validate(v.adjust),
    withActivity({
      action: 'direct-wallet.adjust',
      describe: (req) => ({
        targetType: 'USER',
        targetId: req.body.userId,
        details: { operation: req.body.operation, currency: req.body.currency, amount: req.body.amount, note: req.body.note },
      }),
    }),
    asyncHandler(async (req, res) => response.ok(res, await service.adjust({ ...req.body, actor: actorFrom(req) })))
  );

  router.get(
    '/users/:userId/history',
    ownerOnly,
    validate(v.history),
    asyncHandler(async (req, res) => {
      const { limit, offset, currency } = req.query;
      const result = await service.history({ actor: actorFrom(req), userId: req.params.userId, currency, limit, offset });
      return response.paginated(res, result.rows, { page: Math.floor(offset / limit) + 1, limit, total: result.total });
    })
  );

  return router;
};
