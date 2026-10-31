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
  /** A comma list of notification types (`promotion,bonus`), as a query string carries it. */
  const typeList = z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,39}(,[a-z][a-z0-9_]{0,39}){0,49}$/, 'types must be a comma list of snake_case types')
    .transform((v) => v.split(','))
    .optional();

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
        /**
         * Additive; user-service's player-facing panel has an unread tab.
         *
         * NOT `z.coerce.boolean()`: it maps every non-empty string to `true`,
         * `"false"` included, and this value arrives over HTTP from another
         * service — so `unreadOnly=false` would have filtered the list to
         * unread and made a read notification look deleted. Measured, not
         * theorised; see the note in user-service's validator.
         */
        unreadOnly: z
          .enum(['true', 'false'])
          .default('false')
          .transform((v) => v === 'true'),
        /** Additive: the player panel's tab (its types), and the agent-tree rule (no promotions). */
        types: typeList,
        excludeTypes: typeList,
      }),
    }),
    /**
     * `response.ok` with the total INSIDE `data`, not `response.paginated`.
     *
     * ── THE INTERNAL CLIENT DROPS `meta` ─────────────────────────────────
     *
     * `serviceClient.request` unwraps the standard envelope so callers get the
     * payload directly:
     *
     *     return payload && typeof payload === 'object' && 'data' in payload
     *       ? payload.data : payload;
     *
     * `meta` is not carried with it. So a paginated internal response arrives
     * at the calling service as a bare array with the total gone, and the
     * caller cannot tell a full page from the last one without asking again.
     *
     * This route had NO callers until user-service's notifications module —
     * `/internal/` is blocked at the edge and nothing on this side reached it
     * — so the shape could be settled rather than worked around. Anything
     * paginated that a service means to proxy has the same problem and needs
     * the same answer, or a client that preserves `meta`.
     */
    asyncHandler(async (req, res) => {
      const result = await service.history(req.query);
      return response.ok(res, {
        rows: result.rows,
        total: result.total,
        limit: req.query.limit,
        offset: req.query.offset,
      });
    })
  );

  /**
   * A player event notification from user-service (deposit approved, VIP
   * level-up, …). PUT, because it is idempotent by `key`: a retry lands on
   * the row the first attempt wrote.
   */
  router.put(
    '/player',
    validate({
      body: z
        .object({
          userId,
          kind: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, 'kind must be snake_case'),
          title: z.string().trim().min(1).max(200),
          body: z.string().max(2000).nullish(),
          key: z.string().trim().min(1).max(160),
          data: z.record(z.unknown()).nullish(),
        })
        .strict(),
    }),
    asyncHandler(async (req, res) => {
      const { userId: uid, kind, title, body, key, data } = req.body;
      const result = await service.notifyPlayer({ userId: uid, title, body, type: kind, data, dedupeKey: key });
      return response.ok(res, result);
    })
  );

  router.get(
    '/unread',
    validate({
      query: z.object({
        userId,
        excludeTypes: typeList,
        byType: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
      }),
    }),
    asyncHandler(async (req, res) => response.ok(res, await service.unreadCount(req.query)))
  );

  return router;
};
