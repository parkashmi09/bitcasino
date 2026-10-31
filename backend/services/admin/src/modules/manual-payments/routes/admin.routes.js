'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createActivityRecorder, z } = require('@ibitplay/common');
const { PERMISSIONS, canIssueFunds } = require('@ibitplay/auth');

const { ManualPaymentsService } = require('../manualPayments.service');

const v = {
  set: {
    body: z
      .object({ deposit: z.boolean().optional(), withdraw: z.boolean().optional(), transactionPassword: z.string().min(1).max(200) })
      .strict()
      .refine((b) => b.deposit !== undefined || b.withdraw !== undefined, { message: 'nothing to change' }),
  },
};

/**
 *   GET /admin/manual-payments   { deposit, withdraw, updatedAt, updatedBy }   deposits:read / withdrawals:read
 *   PUT /admin/manual-payments   { deposit?, withdraw?, transactionPassword }  owner (wallet:adjust)
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new ManualPaymentsService(deps);
  const router = Router();
  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });

  router.get(
    '/',
    auth.requireAnyPermission(PERMISSIONS.DEPOSITS_READ, PERMISSIONS.WITHDRAWALS_READ),
    asyncHandler(async (_req, res) => response.ok(res, await service.read()))
  );

  router.put(
    '/',
    auth.requirePermission(PERMISSIONS.WALLET_ADJUST),
    validate(v.set),
    withActivity({
      action: 'payments.manual-switch',
      describe: (req) => ({ targetType: 'SITE', targetId: 'manual-payments', details: { deposit: req.body.deposit, withdraw: req.body.withdraw } }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.set({ actor: { id: req.staff.id, canIssueFunds: canIssueFunds(req.staff) }, ...req.body }))
    )
  );

  return router;
};
