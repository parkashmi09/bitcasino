'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createActivityRecorder, imageUpload } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree } = require('@ibitplay/auth');

const v = require('../avatars.validators');
const errors = require('../avatars.errors');
const { MAX_AVATAR_BYTES } = require('../avatars.constants');
const { AvatarsService } = require('../avatars.service');

/**
 * Managing the avatar set — the house only (an agent account cannot change what every player
 * sees), `config:read` to list and `config:write` to change, every write audited.
 *
 * Uploads are MULTIPART, as banners: the file in field `image`, the rest as form fields
 * (`minLevel`, `sort`, `enabled`). The bytes are judged by their signature, never the name.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new AvatarsService(deps);
  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });
  const houseOnly = denyAgentTree({ code: 'AVATARS_HOUSE_ONLY', message: 'Avatars are managed by the house, not agent accounts' });
  const canRead = auth.requirePermission(PERMISSIONS.CONFIG_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);
  // The multipart parse runs AFTER the permission check, so a caller without the grant never
  // has its body read.
  const upload = imageUpload.singleImage({ field: 'image', errors, maxBytes: MAX_AVATAR_BYTES });
  const router = Router();

  router.get('/', houseOnly, canRead, validate(v.empty), asyncHandler(async (_req, res) => response.ok(res, await service.list())));

  router.post(
    '/',
    houseOnly,
    canWrite,
    ...upload,
    validate(v.create),
    withActivity({
      action: 'avatar.create',
      describe: (req) => ({ targetType: 'AVATAR', targetId: null, details: { ...req.body, bytes: req.file?.size ?? null } }),
    }),
    asyncHandler(async (req, res) =>
      response.created(res, await service.create({ staff: req.staff, file: req.file, ...req.body }))
    )
  );

  router.patch(
    '/:id',
    houseOnly,
    canWrite,
    validate(v.update),
    withActivity({
      action: 'avatar.update',
      describe: (req) => ({ targetType: 'AVATAR', targetId: String(req.params.id), details: req.body }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.update({ staff: req.staff, id: req.params.id, ...req.body }))
    )
  );

  router.put(
    '/:id/image',
    houseOnly,
    canWrite,
    ...upload,
    validate(v.replaceImage),
    withActivity({
      action: 'avatar.image',
      describe: (req) => ({ targetType: 'AVATAR', targetId: String(req.params.id), details: { bytes: req.file?.size ?? null } }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.replaceImage({ staff: req.staff, id: req.params.id, file: req.file }))
    )
  );

  router.delete(
    '/:id',
    houseOnly,
    canWrite,
    validate(v.byId),
    withActivity({
      action: 'avatar.delete',
      describe: (req) => ({ targetType: 'AVATAR', targetId: String(req.params.id) }),
    }),
    asyncHandler(async (req, res) => response.ok(res, await service.remove({ staff: req.staff, id: req.params.id })))
  );

  return router;
};
