'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createActivityRecorder, noBody } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree } = require('@ibitplay/auth');

const v = require('../currencies.validators');
const { CurrenciesService } = require('../currencies.service');
const { singleCoinImage } = require('../coinImage');

/**
 * The coin registry, for staff. House staff only: coins are the site's
 * cashier configuration, not an agent's business (the agent tree gets
 * `403 CURRENCIES_HOUSE_ONLY`, and the site admin hides the screen).
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new CurrenciesService(deps);
  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });
  const houseOnly = denyAgentTree({ code: 'CURRENCIES_HOUSE_ONLY', message: 'Coins are managed by the house, not agent accounts' });
  const canRead = auth.requirePermission(PERMISSIONS.CONFIG_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);
  const router = Router();

  router.get('/', houseOnly, canRead, asyncHandler(async (_req, res) => response.ok(res, await service.list())));

  router.put(
    '/:code',
    houseOnly,
    canWrite,
    validate(v.update),
    withActivity({
      action: 'currencies.update',
      describe: (req) => ({ targetType: 'CURRENCY', targetId: req.params.code, details: req.body }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.update({ code: req.params.code, patch: req.body, staff: req.staff }))
    )
  );

  router.post(
    '/:code/image',
    houseOnly,
    canWrite,
    validate(v.codeParam),
    ...singleCoinImage(),
    noBody(), // after multer: the form carries the file and nothing else
    withActivity({
      action: 'currencies.image',
      describe: (req) => ({
        targetType: 'CURRENCY',
        targetId: req.params.code,
        // What multer measured, so a refused upload is still attributable.
        details: { bytes: req.file?.size ?? null, declaredType: req.file?.mimetype ?? null },
      }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.setImage({ code: req.params.code, file: req.file, staff: req.staff }))
    )
  );

  return router;
};
