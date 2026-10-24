'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../userReports.validators');
const { UserReportsService } = require('../userReports.service');

const actorFrom = (req) => ({ id: req.staff.id, level: req.staff.level });

/**
 * Exchange user reports (zip msadmin) — sab GET, sirf padhna.
 *
 *   GET /admin/exchange/user-reports/home              Home dashboard (cards + charts)
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const service = new UserReportsService(deps);
  const router = Router();

  // Home: wallet dekhne ki koi bhi permission (exchange dashboard jaisa).
  const canSeeWallets = auth.requireAnyPermission(
    PERMISSIONS.WALLET_CREDIT, PERMISSIONS.WALLET_DEBIT, PERMISSIONS.WALLET_ADJUST, PERMISSIONS.USERS_READ
  );

  router.get(
    '/home',
    canSeeWallets,
    validate(v.home),
    asyncHandler(async (req, res) => response.ok(res, await service.home({ actor: actorFrom(req) })))
  );

  return router;
};
