'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../banners.validators');
const { BannersService } = require('../banners.service');
const { createControllers } = require('../controllers');
const { single } = require('../upload');

/**
 * Changing what the site shows.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE GUARD THAT WAS NOT THERE
 *
 * Legacy's two upload routes had no middleware whatsoever. `config:write` and
 * an audit row are the whole fix — but the audit row is the half worth
 * arguing for: the first question after a banner is found to be wrong is who
 * changed it and when, and legacy could not answer it even in principle
 * because it never knew who was uploading.
 * ─────────────────────────────────────────────────────────────────────────
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new BannersService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);

  /**
   * @legacy POST /api/banners/createBanner
   * @legacy POST /api/banners/updateBanner
   *
   * Both legacy paths map here. They were the same operation with two
   * incompatible implementations — see the module header.
   *
   * The multipart parse runs AFTER the permission check, so an unauthenticated
   * request never gets as far as having its body read. Legacy ran multer first
   * and had nothing after it.
   */
  router.post(
    '/',
    canWrite,
    ...single('image'),
    validate(v.createBanner),
    withActivity({
      action: 'banner.replace',
      describe: (req) => ({
        targetType: 'BANNER',
        targetId: req.body.type,
        details: {
          // Recorded from what multer measured, before the service inspects it,
          // so a rejected upload is still attributable.
          bytes: req.file?.size ?? null,
          declaredType: req.file?.mimetype ?? null,
        },
      }),
    }),
    ctrl.putBanner
  );

  /** Take a placement down, or put it back. Legacy had no equivalent. */
  router.patch(
    '/:type/active',
    canWrite,
    validate(v.setActive),
    withActivity({
      action: 'banner.visibility',
      describe: (req) => ({
        targetType: 'BANNER',
        targetId: req.params.type,
        details: { active: req.body.active },
      }),
    }),
    ctrl.setActive
  );

  return router;
};
