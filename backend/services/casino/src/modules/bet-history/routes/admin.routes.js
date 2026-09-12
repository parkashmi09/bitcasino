'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../betHistory.validators');
const { BetHistoryService } = require('../betHistory.service');

/**
 * Staff-facing transaction reporting.
 *
 * EVERY ROUTE HERE WAS UNAUTHENTICATED, and scoped by a raw `x-staff-id`
 * HEADER. Sending `x-staff-id: 1` returned every transaction on the platform —
 * and, because the legacy tree check special-cased that id, also the rows with
 * no owner at all.
 *
 * The staff id comes from a verified token now, and the visible tree is
 * resolved by admin-service, which owns `staff`.
 *
 * ── TWO INDEPENDENT LIMITS, NOT ONE ─────────────────────────────────────
 *
 * Hierarchy scoping (`staffId` on every service call) decides WHICH rows a
 * caller may see. `reports:read` decides whether they may open this report at
 * all. They are not substitutes: scoping alone meant any staff account could
 * pull its own subtree's full financial history, including levels that exist
 * to perform a narrow operational job and have no reporting remit.
 *
 * Applied with `router.use` rather than per-route because every route in this
 * file is the same kind of read — and a blanket guard cannot be forgotten by
 * whoever adds the ninth one.
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const service = new BetHistoryService(deps);
  const router = Router();

  router.use(auth.requirePermission(PERMISSIONS.REPORTS_READ));

  const paged = (req, res, result) =>
    response.paginated(res, result.rows, {
      page: req.query.page,
      limit: req.query.limit,
      total: result.total,
      truncated: result.truncated,
    });

  /** @legacy GET /betHistory/transactions */
  router.get(
    '/transactions',
    validate(v.listing),
    asyncHandler(async (req, res) => paged(req, res, await service.list({ ...req.query, staffId: req.staff.id })))
  );

  /** @legacy GET /betHistory/transactions/user/:userId */
  router.get(
    '/transactions/user/:userId',
    validate(v.userListing),
    asyncHandler(async (req, res) =>
      paged(req, res, await service.listForUser({ ...req.query, ...req.params, staffId: req.staff.id }))
    )
  );

  /** @legacy GET /betHistory/transactions/stats */
  router.get(
    '/stats',
    validate(v.stats),
    asyncHandler(async (req, res) => response.ok(res, await service.stats({ ...req.query, staffId: req.staff.id })))
  );

  /** @legacy GET /betHistory/user/:userId/bet-win-count */
  router.get(
    '/user/:userId/bet-win-count',
    validate(v.userParam),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.betWinCount({ ...req.params, staffId: req.staff.id }))
    )
  );

  /** @legacy GET /betHistory/admin/analytics */
  router.get(
    '/analytics',
    asyncHandler(async (req, res) => response.ok(res, await service.analytics({ staffId: req.staff.id })))
  );

  /**
   * @legacy GET /betHistory/transactions/luckysports
   *
   * The LuckySports feed, from `transaction_live`.
   */
  router.get(
    '/luckysports',
    validate(v.rawListing),
    asyncHandler(async (req, res) =>
      paged(req, res, await service.luckySports({ ...req.query, staffId: req.staff.id }))
    )
  );

  /**
   * @legacy GET /transaction/live
   * @legacy GET /transaction/slot
   *
   * The raw provider tables. Legacy served both unauthenticated and unscoped —
   * the whole table, every row.
   */
  router.get(
    '/transactions/raw/:table',
    validate(v.rawTable),
    asyncHandler(async (req, res) =>
      paged(req, res, await service.rawTransactions({ ...req.params, ...req.query, staffId: req.staff.id }))
    )
  );

  /**
   * @legacy GET /bets
   * @legacy GET /bet2
   *
   *     server.get('/bets', async (req, res) => {
   *       const result = await pg.query('SELECT * FROM bets');
   *       res.json(result.rows);
   *     });
   *
   * Every bet ever placed by every player, in one unauthenticated response.
   */
  router.get(
    '/house/:table',
    validate(v.houseTable),
    asyncHandler(async (req, res) =>
      paged(req, res, await service.houseBets({ ...req.params, ...req.query, staffId: req.staff.id }))
    )
  );

  return router;
};
