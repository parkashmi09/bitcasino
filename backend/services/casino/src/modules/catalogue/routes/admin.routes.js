'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../catalogue.validators');
const { CatalogueService } = require('../catalogue.service');
const { createControllers } = require('../controllers');

/**
 * Catalogue maintenance.
 *
 * The artwork sync rewrites images across the catalogue every visitor's lobby
 * renders from, and it matches games by NAME — so it is behind `config:write`,
 * audited, and its `previewOnly` flag has no default.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new CatalogueService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  /** @legacy POST /update-image, /update-gis-images-run-all */
  router.post(
    '/images/sync',
    auth.requirePermission(PERMISSIONS.CONFIG_WRITE),
    validate(v.syncImages),
    withActivity({
      action: 'catalogue.image-sync',
      describe: (req) => ({
        targetType: 'CATALOGUE',
        details: { previewOnly: req.body.previewOnly, limit: req.body.limit },
      }),
    }),
    ctrl.syncImages
  );

  return router;
};
