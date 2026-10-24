'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');

const v = require('../notifications.validators');
const { NotificationsService } = require('../notifications.service');
const { createControllers } = require('../controllers');

/**
 * What a PLAYER does with their own notifications.
 *
 * `user_notifications` and `user_fcm_tokens` are read and written here because
 * admin-service owns the sending side, so user-service proxies the three
 * player-facing actions rather than both services writing the same tables.
 *
 * The player id arrives from user-service, which has already authenticated
 * them. Legacy took it from the request body on routes with no authentication
 * at all — so anyone could register a device against anyone's account and
 * receive that player's notifications, or mark somebody else's alerts read.
 */
module.exports = function internalRoutes(deps) {
  const service = new NotificationsService(deps);
  const ctrl = createControllers({ service });
  const router = Router();

  const userId = z.coerce.number().int().positive();

  router.post(
    '/devices',
    validate({ body: v.registerDevice.body.extend({ userId }) }),
    ctrl.registerDevice
  );

  router.post(
    '/read',
    validate({ body: v.markRead.body.extend({ userId }) }),
    ctrl.markRead
  );

  router.get(
    '/history',
    validate({
      query: z.object({
        userId,
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
    }),
    asyncHandler(async (req, res) => {
      const result = await service.history(req.query);
      return response.paginated(res, result.rows, {
        page: Math.floor(req.query.offset / req.query.limit) + 1,
        limit: req.query.limit,
        total: result.total,
      });
    })
  );

  router.get(
    '/unread',
    validate({ query: z.object({ userId }) }),
    asyncHandler(async (req, res) => response.ok(res, await service.unreadCount(req.query)))
  );

  return router;
};
