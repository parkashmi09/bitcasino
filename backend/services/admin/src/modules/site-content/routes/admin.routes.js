'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree } = require('@ibitplay/auth');

const v = require('../siteContent.validators');
const { siteContentService } = require('../siteContent.service');

/** The site admin's Content screen: read every section, replace one. House staff only, like site-config. */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const service = siteContentService(deps);
  const router = Router();
  const houseOnly = denyAgentTree({ code: 'SITE_CONTENT_HOUSE_ONLY', message: 'Site content is set by the Super Admin, not agent accounts' });
  const withActivity = createActivityRecorder({ client: deps.clients?.admin, logger: deps.logger, serviceName: deps.config.SERVICE_NAME });

  router.get(
    '/',
    houseOnly,
    auth.requirePermission(PERMISSIONS.CONFIG_READ),
    validate({ query: v.emptyQuery }),
    asyncHandler(async (_req, res) => response.ok(res, { keys: v.KEYS, networks: v.NETWORKS, content: await service.all() }))
  );

  router.put(
    '/:key',
    houseOnly,
    auth.requirePermission(PERMISSIONS.CONFIG_WRITE),
    validate({ params: v.keyParams }),
    // The body's schema depends on the key.
    (req, res, next) => validate({ body: v.SECTIONS[req.params.key] })(req, res, next),
    withActivity({ action: 'site-content.update', describe: (req) => ({ targetType: 'SITE_CONTENT', targetId: req.params.key }) }),
    asyncHandler(async (req, res) => response.ok(res, { key: req.params.key, value: await service.set(req.params.key, req.body, req.staff?.id) }))
  );

  return router;
};
