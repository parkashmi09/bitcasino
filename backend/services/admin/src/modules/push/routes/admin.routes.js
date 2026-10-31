'use strict';

const { Router } = require('express');
const {
  validate,
  response,
  asyncHandler,
  createActivityRecorder,
  imageUpload,
  noBody,
} = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../push.validators');
const errors = require('../push.errors');
const { MAX_IMAGE_BYTES, MAX_SOUND_BYTES } = require('../push.constants');
const { PushService } = require('../push.service');

/**
 * Staff push routes. Reads need `config:read`; anything that sends, schedules
 * or changes what players see needs `config:write` (the broadcast rule), and
 * every write is audited with what was said and to whom.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new PushService(deps);
  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.CONFIG_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);

  const h = (fn, reply = response.ok) => asyncHandler(async (req, res) => reply(res, await fn(req)));
  const audit = (action, details) =>
    withActivity({
      action,
      describe: (req) => ({
        targetType: 'PUSH',
        targetId: req.params.id ?? req.params.kind ?? null,
        details: details(req),
      }),
    });
  const what = (req) => ({ title: req.body?.title, body: req.body?.body, audience: req.body?.audience?.kind, imageUrl: req.body?.imageUrl ?? null });

  // ── Status, settings ──
  router.get('/status', canRead, h(() => service.status()));
  router.get('/settings', canRead, h(() => service.settings()));
  router.put(
    '/settings',
    canWrite,
    validate(v.putSettings),
    audit('push.settings', (req) => req.body),
    h((req) => service.saveSettings({ ...req.body, staff: req.staff }))
  );

  // ── Images ──
  router.post(
    '/images',
    canWrite,
    ...imageUpload.singleImage({ field: 'image', errors, maxBytes: MAX_IMAGE_BYTES }),
    noBody(), // after multer: the form carries the file and nothing else
    audit('push.image.upload', (req) => ({ bytes: req.file?.size ?? null, declaredType: req.file?.mimetype ?? null })),
    h((req) => service.uploadImage({ file: req.file, staff: req.staff }), response.created)
  );

  // ── Notification sound ──
  router.post(
    '/sound',
    canWrite,
    imageUpload.createUploader({ maxBytes: MAX_SOUND_BYTES }).single('sound'),
    imageUpload.createUploadErrorHandler({ TOO_LARGE: errors.SOUND_TOO_LARGE, NO_FILE: errors.SOUND_NO_FILE }, MAX_SOUND_BYTES),
    noBody(),
    audit('push.sound.upload', (req) => ({ bytes: req.file?.size ?? null, declaredType: req.file?.mimetype ?? null })),
    h((req) => service.uploadSound({ file: req.file, staff: req.staff }), response.created)
  );

  // ── Templates ──
  router.get('/templates', canRead, h(() => service.listTemplates()));
  router.put(
    '/templates/:kind',
    canWrite,
    validate(v.putTemplate),
    audit('push.template.save', (req) => ({ kind: req.params.kind, ...req.body })),
    h((req) => service.putTemplate({ ...req.body, kind: req.params.kind, staff: req.staff }))
  );
  router.delete(
    '/templates/:kind',
    noBody(),
    canWrite,
    validate(v.templateParam),
    audit('push.template.reset', (req) => ({ kind: req.params.kind })),
    h((req) => service.resetTemplate({ kind: req.params.kind }))
  );

  // ── Compose helpers ──
  router.post('/preview', canRead, validate(v.preview), h((req) => service.preview({ ...req.body, staff: req.staff })));
  router.post(
    '/test',
    canWrite,
    validate(v.testSend),
    audit('push.test', (req) => ({ userId: req.body.userId, ...what(req) })),
    h((req) => service.testSend({ ...req.body, staff: req.staff }), response.accepted)
  );

  // ── Campaigns ──
  router.get(
    '/campaigns',
    canRead,
    validate(v.list),
    asyncHandler(async (req, res) => {
      const out = await service.listCampaigns(req.query);
      return response.paginated(res, out.rows, {
        page: Math.floor(req.query.offset / req.query.limit) + 1,
        limit: req.query.limit,
        total: out.total,
      });
    })
  );
  router.get('/campaigns/:id', canRead, validate(v.campaignParam), h((req) => service.getCampaign({ id: req.params.id })));
  router.post(
    '/campaigns',
    canWrite,
    validate(v.create),
    audit('push.campaign.create', what),
    h((req) => service.createCampaign({ ...req.body, staff: req.staff }), response.created)
  );
  router.put(
    '/campaigns/:id',
    canWrite,
    validate(v.update),
    audit('push.campaign.update', what),
    h((req) => service.updateCampaign({ ...req.body, id: req.params.id, staff: req.staff }))
  );
  router.delete(
    '/campaigns/:id',
    noBody(),
    canWrite,
    validate(v.campaignParam),
    audit('push.campaign.delete', () => ({})),
    h((req) => service.deleteCampaign({ id: req.params.id }))
  );
  router.post(
    '/campaigns/:id/send',
    noBody(),
    canWrite,
    validate(v.campaignParam),
    audit('push.campaign.send', () => ({})),
    h((req) => service.sendCampaign({ id: req.params.id, staff: req.staff }), response.accepted)
  );
  router.post(
    '/campaigns/:id/schedule',
    canWrite,
    validate(v.schedule),
    audit('push.campaign.schedule', (req) => ({ sendAt: req.body.sendAt })),
    h((req) => service.scheduleCampaign({ id: req.params.id, sendAt: req.body.sendAt, staff: req.staff }))
  );
  router.post(
    '/campaigns/:id/cancel',
    noBody(),
    canWrite,
    validate(v.campaignParam),
    audit('push.campaign.cancel', () => ({})),
    h((req) => service.cancelCampaign({ id: req.params.id, staff: req.staff }))
  );
  router.post(
    '/campaigns/:id/test',
    canWrite,
    validate(v.testCampaign),
    audit('push.campaign.test', (req) => ({ userId: req.body.userId })),
    h((req) => service.testCampaign({ id: req.params.id, userId: req.body.userId, staff: req.staff }), response.accepted)
  );

  return router;
};
