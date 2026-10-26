'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS, canIssueFunds } = require('@ibitplay/auth');

const v = require('../branches.validators');
const errors = require('../branches.errors');
const { BranchesService } = require('../branches.service');

/**
 * Branch Management — the Super Admin's side (and its executives, by their grants).
 *
 *   GET   /admin/branches                         list
 *   POST  /admin/branches                         create { name, username, password }
 *   PATCH /admin/branches/:branchId               { name?, status? }  (inactive = signed out)
 *   PUT   /admin/branches/:branchId/password      { password }        (signed out)
 *   GET   /admin/branches/report                  every branch over ?from&to
 *   GET   /admin/branches/:branchId/summary       ?from&to
 *   GET   /admin/branches/:branchId/players       ?search&limit&offset
 *   POST  /admin/branches/:branchId/players       { username, password, email?, phone? }
 *   GET   /admin/branches/:branchId/statement     ?fromDate&toDate&category&userId&page&limit
 *   GET   /admin/branches/:branchId/players/:userId
 *   GET   /admin/branches/:branchId/deposits      ?fromDate&toDate&status&userId&page&limit
 *   GET   /admin/branches/:branchId/withdrawals   (same)
 *   GET   /admin/branches/:branchId/bets          ?kind=originals|casino|sports&fromDate&toDate&userId&page&limit
 *
 * All of it 403 BRANCH_DISABLED while the owner's `branch_management` is off.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new BranchesService(deps);
  const router = Router();
  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });

  const ownerOnly = asyncHandler(async (req, _res, next) => {
    if (!canIssueFunds(req.staff)) throw errors.OWNER_ONLY();
    await service.assertEnabled();
    next();
  });
  const canRead = [auth.requirePermission(PERMISSIONS.REPORTS_READ), ownerOnly];
  const canWrite = [auth.requirePermission(PERMISSIONS.STAFF_WRITE), ownerOnly];
  const audited = (action) =>
    withActivity({
      action,
      describe: (req) => ({
        targetType: 'BRANCH',
        targetId: req.params.branchId,
        // Never the password itself.
        details: { fields: Object.keys(req.body ?? {}).filter((k) => k !== 'password'), status: req.body?.status },
      }),
    });

  router.get(
    '/',
    canRead,
    validate(v.list),
    asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      const result = await service.list(req.query);
      return response.paginated(res, result.rows, { page: Math.floor(offset / limit) + 1, limit, total: result.total });
    })
  );

  router.post(
    '/',
    canWrite,
    validate(v.create),
    audited('branch.create'),
    asyncHandler(async (req, res) => response.created(res, await service.create({ ...req.body, actor: req.staff })))
  );

  router.get('/report', canRead, validate(v.report), asyncHandler(async (req, res) => response.ok(res, await service.report(req.query))));

  router.patch(
    '/:branchId',
    canWrite,
    validate(v.update),
    audited('branch.update'),
    asyncHandler(async (req, res) => response.ok(res, await service.update({ ...req.body, branchId: req.params.branchId })))
  );

  router.put(
    '/:branchId/password',
    canWrite,
    validate(v.password),
    audited('branch.password'),
    asyncHandler(async (req, res) => response.ok(res, await service.setPassword({ ...req.body, branchId: req.params.branchId })))
  );

  router.get(
    '/:branchId/summary',
    canRead,
    validate(v.summary),
    asyncHandler(async (req, res) => response.ok(res, await service.summary({ ...req.query, branchId: req.params.branchId })))
  );

  router.get(
    '/:branchId/players',
    canRead,
    validate(v.players),
    asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      const result = await service.players({ ...req.query, branchId: req.params.branchId });
      return response.paginated(res, result.rows, { page: Math.floor(offset / limit) + 1, limit, total: result.total });
    })
  );

  router.post(
    '/:branchId/players',
    canWrite,
    validate(v.createPlayer),
    audited('branch.player-create'),
    asyncHandler(async (req, res) => response.created(res, await service.createPlayer({ ...req.body, branchId: req.params.branchId })))
  );

  router.get(
    '/:branchId/players/:userId',
    canRead,
    validate(v.player),
    asyncHandler(async (req, res) => response.ok(res, await service.player(req.params)))
  );

  for (const kind of ['deposits', 'withdrawals']) {
    router.get(
      `/:branchId/${kind}`,
      canRead,
      validate(v.money),
      asyncHandler(async (req, res) => response.ok(res, await service.money({ ...req.query, kind, branchId: req.params.branchId })))
    );
  }

  router.get(
    '/:branchId/bets',
    canRead,
    validate(v.bets),
    asyncHandler(async (req, res) => response.ok(res, await service.bets({ ...req.query, branchId: req.params.branchId })))
  );

  router.get(
    '/:branchId/statement',
    canRead,
    validate(v.statement),
    asyncHandler(async (req, res) => response.ok(res, await service.statement({ ...req.query, branchId: req.params.branchId })))
  );

  return router;
};
