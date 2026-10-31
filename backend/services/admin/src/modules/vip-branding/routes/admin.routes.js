'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createActivityRecorder, imageUpload } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree } = require('@ibitplay/auth');

const v = require('../vipBranding.validators');
const errors = require('../vipBranding.errors');
const { VipBrandingService, MAX_BADGE_BYTES } = require('../vipBranding.service');

/** House only, `config:read` / `config:write`, every write audited — as the avatars module. */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new VipBrandingService(deps);
  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });
  const houseOnly = denyAgentTree({ code: 'VIP_BRANDING_HOUSE_ONLY', message: 'VIP names and badges are managed by the house' });
  const canRead = auth.requirePermission(PERMISSIONS.CONFIG_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);
  const upload = imageUpload.singleImage({ field: 'image', errors, maxBytes: MAX_BADGE_BYTES });
  const router = Router();

  router.get('/', houseOnly, canRead, validate(v.empty), asyncHandler(async (_req, res) => response.ok(res, await service.view())));

  router.put(
    '/levels/:level',
    houseOnly,
    canWrite,
    validate(v.rename),
    withActivity({ action: 'vip.rename', describe: (req) => ({ targetType: 'VIP_LEVEL', targetId: String(req.params.level), details: req.body }) }),
    asyncHandler(async (req, res) => response.ok(res, await service.rename({ staff: req.staff, level: req.params.level, name: req.body.name, minXp: req.body.minXp })))
  );

  router.get('/perks/manage', houseOnly, canRead, asyncHandler(async (_req, res) => response.ok(res, await service.listPerks())));

  router.post(
    '/perks',
    houseOnly,
    canWrite,
    validate(v.addPerk),
    withActivity({ action: 'vip.perk.add', describe: (req) => ({ targetType: 'VIP_PERK', details: { label: req.body.label } }) }),
    asyncHandler(async (req, res) => response.created(res, await service.addPerk({ staff: req.staff, label: req.body.label })))
  );

  router.put(
    '/perks/:id',
    houseOnly,
    canWrite,
    validate(v.setPerk),
    withActivity({ action: 'vip.perk.update', describe: (req) => ({ targetType: 'VIP_PERK', targetId: String(req.params.id), details: req.body }) }),
    asyncHandler(async (req, res) => response.ok(res, await service.setPerk({ staff: req.staff, id: req.params.id, ...req.body })))
  );

  router.delete(
    '/perks/:id',
    houseOnly,
    canWrite,
    validate(v.removePerk),
    withActivity({ action: 'vip.perk.delete', describe: (req) => ({ targetType: 'VIP_PERK', targetId: String(req.params.id) }) }),
    asyncHandler(async (req, res) => response.ok(res, await service.removePerk({ id: req.params.id })))
  );

  router.post(
    '/levels',
    houseOnly,
    canWrite,
    validate(v.addLevel),
    withActivity({ action: 'vip.level.add', describe: (req) => ({ targetType: 'VIP_LEVEL', details: { name: req.body.name, minXp: req.body.minXp, card: req.body.card } }) }),
    asyncHandler(async (req, res) => response.created(res, await service.addLevel({ staff: req.staff, ...req.body })))
  );

  router.put(
    '/levels/:level/enabled',
    houseOnly,
    canWrite,
    validate(v.setEnabled),
    withActivity({ action: 'vip.level.enabled', describe: (req) => ({ targetType: 'VIP_LEVEL', targetId: String(req.params.level), details: { enabled: req.body.enabled } }) }),
    asyncHandler(async (req, res) => response.ok(res, await service.setEnabled({ staff: req.staff, level: req.params.level, enabled: req.body.enabled })))
  );

  router.delete(
    '/levels/:level',
    houseOnly,
    canWrite,
    validate(v.removeLevel),
    withActivity({ action: 'vip.level.delete', describe: (req) => ({ targetType: 'VIP_LEVEL', targetId: String(req.params.level) }) }),
    asyncHandler(async (req, res) => response.ok(res, await service.removeLevel({ level: req.params.level })))
  );

  router.put(
    '/badges/:card',
    houseOnly,
    canWrite,
    ...upload,
    validate(v.badge),
    withActivity({ action: 'vip.badge', describe: (req) => ({ targetType: 'VIP_CARD', targetId: req.params.card, details: { bytes: req.file?.size ?? null } }) }),
    asyncHandler(async (req, res) => response.ok(res, await service.setBadge({ staff: req.staff, card: req.params.card, file: req.file })))
  );

  router.delete(
    '/badges/:card',
    houseOnly,
    canWrite,
    validate(v.byCard),
    withActivity({ action: 'vip.badge.delete', describe: (req) => ({ targetType: 'VIP_CARD', targetId: req.params.card }) }),
    asyncHandler(async (req, res) => response.ok(res, await service.removeBadge({ card: req.params.card })))
  );

  return router;
};
