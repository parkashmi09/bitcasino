'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, z } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const ownerErrors = require('../../features/owner.errors');
const { WithdrawalControlService } = require('../withdrawalControl.service');

const v = {
  users: {
    query: z
      .object({
        search: z.string().trim().min(1).max(80).optional(),
        status: z.enum(['all', 'locked']).default('all'),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .strict(),
  },
};

/**
 *   GET /admin/withdrawal-control          summary (global, limit, wagering bonus, ginti)   reports:read
 *   GET /admin/withdrawal-control/users    direct users: balance, deposited, wagered, withdrawn / max, lock
 *   PUT /admin/withdrawal-control/global   403 OWNER_MANAGED — owner panel → Features & plan → Withdrawals
 * Global ON / OFF, limit, wagering bonus: owner panel only (GET me read-only).
 * Per-user lock: purana `POST admin/locks` (users:write).
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const service = new WithdrawalControlService(deps);
  const router = Router();
  // Direct users only: owner (wallet:adjust), never an agent login.
  const canRead = auth.requirePermission(PERMISSIONS.WALLET_ADJUST);

  router.get('/', canRead, asyncHandler(async (_req, res) => response.ok(res, await service.read())));

  router.get(
    '/users',
    canRead,
    validate(v.users),
    asyncHandler(async (req, res) => {
      const result = await service.users(req.query);
      const page = Math.floor(req.query.offset / req.query.limit) + 1;
      return response.paginated(res, result.rows, { page, limit: req.query.limit, total: result.total });
    })
  );

  // The global switch is the owner's now (document `withdrawalsEnabled`); an old admin build gets a clear refusal.
  router.put('/global', auth.requirePermission(PERMISSIONS.WALLET_ADJUST), (_req, _res, next) =>
    next(ownerErrors.MANAGED({ feature: 'withdrawals_enabled' }))
  );

  return router;
};
