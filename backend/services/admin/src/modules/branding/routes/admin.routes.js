'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, imageUpload, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree } = require('@ibitplay/auth');

const v = require('../branding.validators');
const errors = require('../branding.errors');
const { brandingStore } = require('../branding.store');
const { MAX_IMAGE_BYTES } = require('../branding.rules');

/**
 * `GET /api/v1/admin/branding` (config:read) — the site admin's read-only view: the same block
 * players get, plus `managedBy: 'owner'` (null when no owner panel manages this site) and `metaBy`.
 * The Super Admin may also set the logo and the icon (PUT / DELETE `/:slot`) and the name and
 * metadata (PUT / DELETE `/meta`): the newer of the Super Admin's and the owner's shows
 * (branding.store.js `effective`).
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const store = deps.brandingStore ?? brandingStore(deps);
  const router = Router();
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);
  const houseOnly = denyAgentTree({ code: 'BRANDING_HOUSE_ONLY', message: 'The logo is set by the Super Admin, not agent accounts' });
  const withActivity = createActivityRecorder({ client: deps.clients?.admin, logger: deps.logger, serviceName: deps.config.SERVICE_NAME });
  const ownerBranding = () => deps.entitlementsStore?.current()?.branding ?? null;
  const maxBytes = Math.max(MAX_IMAGE_BYTES.logo, MAX_IMAGE_BYTES.mark);

  router.get(
    '/',
    auth.requirePermission(PERMISSIONS.CONFIG_READ),
    validate({ query: v.emptyQuery }),
    asyncHandler(async (_req, res) => {
      const current = deps.entitlementsStore?.current() ?? {};
      return response.ok(res, {
        ...store.view(current.branding ?? null, current.version ?? 0, await store.chatSettings()),
        managedBy: deps.config.OWNER_SHARED_SECRET ? 'owner' : null,
        metaBy: store.metaBySite(current.branding ?? null) ? 'site' : 'platform',
        source: current.source ?? 'default',
      });
    })
  );

  // Before '/:slot', which would take 'meta' as a slot.
  router.put(
    '/meta',
    houseOnly,
    canWrite,
    validate({ body: v.siteMeta }),
    withActivity({ action: 'branding.meta.set', describe: () => ({ targetType: 'BRANDING', targetId: 'meta' }) }),
    asyncHandler(async (req, res) => response.ok(res, await store.setMeta(req.body, { staff: req.staff, ownerBranding: ownerBranding() })))
  );

  router.delete(
    '/meta',
    houseOnly,
    canWrite,
    withActivity({ action: 'branding.meta.reset', describe: () => ({ targetType: 'BRANDING', targetId: 'meta' }) }),
    asyncHandler(async (_req, res) => {
      await store.clearMeta();
      return response.ok(res, { reset: true });
    })
  );

  router.put(
    '/:slot',
    houseOnly,
    canWrite,
    validate({ params: v.siteSlot }),
    imageUpload.createUploader({ maxBytes }).single('image'),
    imageUpload.createUploadErrorHandler(errors, maxBytes),
    withActivity({ action: 'branding.set', describe: (req) => ({ targetType: 'BRANDING', targetId: req.params.slot, details: { bytes: req.file?.size ?? null } }) }),
    asyncHandler(async (req, res) => {
      if (!req.file?.buffer?.length) throw errors.NO_FILE();
      return response.ok(res, await store.setSite(req.params.slot, req.file.buffer, { staff: req.staff, ownerBranding: ownerBranding() }));
    })
  );

  router.delete(
    '/:slot',
    houseOnly,
    canWrite,
    validate({ params: v.siteSlot }),
    withActivity({ action: 'branding.reset', describe: (req) => ({ targetType: 'BRANDING', targetId: req.params.slot }) }),
    asyncHandler(async (req, res) => response.ok(res, await store.clearSite(req.params.slot, { ownerBranding: ownerBranding() })))
  );

  return router;
};
