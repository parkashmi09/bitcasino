'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../depositReports.validators');
const { DepositReportsService } = require('../depositReports.service');

/**
 * Deposit reporting, scoped to the caller's own agent tree.
 *
 * Every route here was previously unauthenticated and took the reporting scope
 * from an `x-staff-id` request header. `req.staff` below comes from a verified
 * staff token — the guard is attached by the module loader, not by this file,
 * so it cannot be forgotten.
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const service = new DepositReportsService(deps);
  const router = Router();

  const paging = (q) => ({ limit: q.limit, offset: (q.page - 1) * q.limit });
  const range = (q) => ({ from: q.startDate, to: q.endDate });

  router.get(
    '/crypto/deposits',
    auth.requirePermission(PERMISSIONS.DEPOSITS_READ),
    validate(v.cryptoList),
    asyncHandler(async (req, res) => {
      const result = await service.listCryptoDeposits({
        staff: req.staff,
        ...range(req.query),
        ...paging(req.query),
        status: req.query.status,
        userId: req.query.userid,
        chain: req.query.chain,
      });
      return response.paginated(res, result.rows, {
        page: req.query.page,
        limit: req.query.limit,
        total: result.total,
      });
    })
  );

  router.get(
    '/crypto/stats',
    auth.requirePermission(PERMISSIONS.REPORTS_READ),
    validate(v.cryptoStats),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.cryptoStats({ staff: req.staff, ...range(req.query) }))
    )
  );

  router.get(
    '/fiat/deposits',
    auth.requirePermission(PERMISSIONS.DEPOSITS_READ),
    validate(v.fiatList),
    asyncHandler(async (req, res) => {
      const result = await service.listFiatDeposits({
        staff: req.staff,
        ...range(req.query),
        ...paging(req.query),
        status: req.query.status,
        userId: req.query.userid,
        currency: req.query.currency,
        provider: req.query.provider,
      });
      return response.paginated(res, result.rows, {
        page: req.query.page,
        limit: req.query.limit,
        total: result.total,
      });
    })
  );

  router.get(
    '/fiat/stats',
    auth.requirePermission(PERMISSIONS.REPORTS_READ),
    validate(v.fiatStats),
    asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.fiatStats({ staff: req.staff, ...range(req.query), currency: req.query.currency })
      )
    )
  );

  /**
   * @legacy POST /api/deposit/user-pl
   * @legacy POST /api/deposit/staff-pl
   *
   * Profit and loss, per player and per staff subtree.
   *
   * Legacy served both as POSTs with the id in the body on a router with NO
   * authentication middleware at all — so any id returned that account's
   * financial position. They are GETs behind `reports:read` here, scoped to the
   * caller's own tree.
   *
   * The figure itself was also wrong: `deposits − withdrawals`, ignoring the
   * balance the player is still holding and counting only agent transfers as
   * deposits. See the service.
   */
  router.get(
    '/profit-loss/user/:userId',
    auth.requirePermission(PERMISSIONS.REPORTS_READ),
    validate(v.userProfitLoss),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.userProfitLoss({ staff: req.staff, userId: req.params.userId }))
    )
  );

  router.get(
    '/profit-loss/staff/:staffId',
    auth.requirePermission(PERMISSIONS.REPORTS_READ),
    validate(v.staffProfitLoss),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.staffProfitLoss({ staff: req.staff, staffId: req.params.staffId }))
    )
  );

  return router;
};
