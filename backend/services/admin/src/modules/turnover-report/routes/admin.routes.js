'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createActivityRecorder, z } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const { TurnoverReportService } = require('../turnoverReport.service');

// 0 = no rollover (target 0, which clears the withdrawal requirement).
const multiplier = z.coerce.number().min(0).max(100);

const v = {
  list: {
    query: z
      .object({
        search: z.string().trim().min(1).max(80).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .strict(),
  },
  setAll: { body: z.object({ multiplier }).strict() },
  setUser: {
    params: z.object({ userId: z.coerce.number().int().positive() }),
    body: z
      .object({ multiplier: multiplier.optional(), locked: z.boolean().optional() })
      .strict()
      .refine((b) => b.multiplier !== undefined || b.locked !== undefined, { message: 'nothing to change' }),
  },
};

/**
 *   GET /admin/turnover-report               direct users: wager, deposit, target, %     wallet:adjust (owner)
 *   GET /admin/turnover-report/multiplier    default TargetX                               wallet:adjust (owner)
 *   PUT /admin/turnover-report/multiplier    "Update All TargetX"                         config:write
 *   PUT /admin/turnover-report/:userId       user ka TargetX / lock                        config:write
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new TurnoverReportService(deps);
  const router = Router();
  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);

  router.get(
    '/',
    auth.requirePermission(PERMISSIONS.WALLET_ADJUST),
    validate(v.list),
    asyncHandler(async (req, res) => {
      const result = await service.list(req.query);
      const page = Math.floor(req.query.offset / req.query.limit) + 1;
      return response.paginated(res, result.rows, { page, limit: req.query.limit, total: result.total });
    })
  );

  router.get(
    '/multiplier',
    auth.requirePermission(PERMISSIONS.WALLET_ADJUST),
    asyncHandler(async (_req, res) => response.ok(res, await service.settings()))
  );

  router.put(
    '/multiplier',
    canWrite,
    validate(v.setAll),
    withActivity({ action: 'turnover.multiplier', describe: (req) => ({ targetType: 'SITE', targetId: 'turnover', details: req.body }) }),
    asyncHandler(async (req, res) => response.ok(res, await service.setAll({ actor: { id: req.staff.id }, ...req.body })))
  );

  router.put(
    '/:userId',
    canWrite,
    validate(v.setUser),
    withActivity({ action: 'turnover.user', describe: (req) => ({ targetType: 'USER', targetId: req.params.userId, details: req.body }) }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.setUser({ actor: { id: req.staff.id }, userId: req.params.userId, ...req.body }))
    )
  );

  return router;
};
