'use strict';

/**
 * OneSignal web push composed by staff — campaigns (compose, preview, send,
 * schedule, cancel, test), notification images, per-event push templates and
 * the soft-ask prompt settings. See push.service.js and docs/ONESIGNAL.md.
 *
 *   staff   /api/v1/admin/push/…
 *   public  /api/v1/admin/push/images/:file   (OneSignal and browsers fetch images)
 *           /api/v1/admin/push/prompt         (the front end's popup copy)
 */
module.exports = {
  name: 'push',
  service: 'admin',
  basePath: '/push',
  models: ['admin', 'core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
  },
};
