'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../features.validators');
const templateErrors = require('../template.errors');
const { FeaturesService } = require('../features.service');

/**
 * The operator's view of this site's features.
 *
 * Reads need `config:read`; every write needs `config:write` and is audited.
 * The catalogue carries no `builtFor`: which site a variant came from is never shown.
 * The audit line records WHICH secret names changed and never their values —
 * the recorder is handed the body, so `details` is built here by hand rather
 * than passed through.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new FeaturesService(deps);
  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });
  const canRead = auth.requirePermission(PERMISSIONS.CONFIG_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);
  const router = Router();

  router.get('/catalogue', canRead, (_req, res) => response.ok(res, service.catalogue()));

  router.get('/', canRead, asyncHandler(async (_req, res) => response.ok(res, await service.list())));

  /**
   * The template is the owner's (docs/OWNER-PANEL.md §4): it arrives in the
   * entitlement document and the entitlements store applies it. Staff are refused whatever
   * the body says; registered before `/:feature` so `template` is never read as
   * a feature key.
   */
  router.put('/template', canWrite, (_req, _res, next) => next(templateErrors.OWNER_ONLY()));

  /**
   * With an owner panel, a feature's on/off and variant are the owner's
   * (403 OWNER_MANAGED, see owner.errors.js); staff may still save the config
   * and keys of the current variant.
   */
  router.put(
    '/:feature',
    canWrite,
    validate(v.update),
    withActivity({
      action: 'features.update',
      describe: (req) => ({
        targetType: 'FEATURE',
        targetId: req.params.feature,
        details: {
          enabled: req.body.enabled,
          variant: req.body.variant,
          config: req.body.config,
          secretsChanged: Object.keys(req.body.secrets ?? {}),
        },
      }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.update({ feature: req.params.feature, patch: req.body, staff: req.staff }))
    )
  );

  router.post(
    '/:feature/test',
    canWrite,
    validate(v.test),
    withActivity({
      action: 'features.test',
      describe: (req) => ({ targetType: 'FEATURE', targetId: req.params.feature, details: { userId: req.body.userId ?? null } }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.test({ feature: req.params.feature, ...req.body, staff: req.staff }))
    )
  );

  return router;
};
