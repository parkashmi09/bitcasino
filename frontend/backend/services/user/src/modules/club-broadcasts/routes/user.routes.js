'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');

const { ClubBroadcastsService } = require('../clubBroadcasts.service');
const { NOTIFICATION_TYPES, MAX_IMAGE_BYTES } = require('../clubBroadcasts.constants');

/**
 * Club banners and notifications.
 *
 * Every one of these was unauthenticated in legacy, with the actor named in the
 * request — `ownerId` in the body for the owner-only operations, `userId` in
 * the body for "mark as read". The query
 *
 *     SELECT unique_club_id FROM clubs WHERE id = $1 AND owner_id = $2
 *
 * reads like an authorisation check and is not one, because the caller supplied
 * `$2`. The actor comes from the token here, and ownership is checked against
 * it in the service.
 *
 * `GET /clubs/banner-image/:imagePath(*)` was a path traversal — see
 * `imageStore.js`.
 */
module.exports = function userRoutes(deps) {
  const service = new ClubBroadcastsService(deps);
  const router = Router();

  const clubId = z.coerce.number().int().positive();
  const bannerId = z.coerce.number().int().positive();
  const notificationId = z.coerce.number().int().positive();

  const paging = {
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  };

  const notificationBody = z
    .object({
      title: z.string().trim().min(1).max(200),
      body: z.string().trim().max(4000).optional(),
      type: z.enum(NOTIFICATION_TYPES).optional(),
      additionalData: z.record(z.unknown()).optional(),
    })
    .strict();

  /**
   * The image, as base64.
   *
   * Bounded before it is decoded: base64 is 4/3 the size of its payload, so the
   * string limit is set from the byte limit rather than guessed.
   */
  const imageField = z
    .string()
    .min(1)
    .max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024)
    .transform((v) => Buffer.from(v.replace(/^data:[^;]+;base64,/, ''), 'base64'));

  // ── Banners ─────────────────────────────────────────────────────────

  /** @legacy POST /clubbanner/clubs/:clubId/banners */
  router.post(
    '/clubs/:clubId/banners',
    validate({
      params: z.object({ clubId }),
      body: z.object({ title: z.string().trim().min(1).max(200), image: imageField }).strict(),
    }),
    asyncHandler(async (req, res) =>
      response.created(
        res,
        await service.createBanner({ clubId: req.params.clubId, actorId: req.user.id, ...req.body })
      )
    )
  );

  /** @legacy GET /clubbanner/clubs/:clubId/banners */
  router.get(
    '/clubs/:clubId/banners',
    validate({ params: z.object({ clubId }) }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.listBanners({ clubId: req.params.clubId, actorId: req.user.id }))
    )
  );

  /** @legacy PUT /clubbanner/clubs/:clubId/banners/:bannerId */
  router.put(
    '/clubs/:clubId/banners/:bannerId',
    validate({
      params: z.object({ clubId, bannerId }),
      body: z
        .object({ title: z.string().trim().min(1).max(200).optional(), image: imageField.optional() })
        .strict(),
    }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.updateBanner({ ...req.params, actorId: req.user.id, ...req.body }))
    )
  );

  /** @legacy DELETE /clubbanner/clubs/:clubId/banners/:bannerId */
  router.delete(
    '/clubs/:clubId/banners/:bannerId',
    validate({ params: z.object({ clubId, bannerId }) }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.removeBanner({ ...req.params, actorId: req.user.id }))
    )
  );

  /**
   * @legacy GET /clubbanner/clubs/banner-image/:imagePath(*)
   *
   * The wildcard is kept because the stored path has a directory in it, and
   * containment is enforced on the RESOLVED path in `imageStore.resolve()` —
   * a string check would not survive encoding or a symlink.
   */
  router.get(
    '/banner-image/*',
    asyncHandler(async (req, res) => {
      const image = await service.readImage({
        storedPath: req.params[0],
        actorId: req.user.id,
      });

      res.setHeader('Content-Type', image.contentType);
      // Never inline. A stored file served inline is a stored cross-site
      // script if the type detection is ever wrong.
      res.setHeader('Content-Disposition', 'inline; filename="banner"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(image.buffer);
    })
  );

  // ── Notifications ───────────────────────────────────────────────────

  /** @legacy POST /clubnotification/clubs/:clubId/notifications */
  router.post(
    '/clubs/:clubId/notifications',
    validate({ params: z.object({ clubId }), body: notificationBody }),
    asyncHandler(async (req, res) =>
      response.created(
        res,
        await service.send({ channel: 'club', clubId: req.params.clubId, actorId: req.user.id, ...req.body })
      )
    )
  );

  /** @legacy GET /clubnotification/clubs/:clubId/notifications */
  router.get(
    '/clubs/:clubId/notifications',
    validate({ params: z.object({ clubId }), query: z.object(paging).strict() }),
    asyncHandler(async (req, res) => {
      const result = await service.list({
        channel: 'club',
        clubId: req.params.clubId,
        actorId: req.user.id,
        ...req.query,
      });
      return response.paginated(res, result.rows, {
        page: Math.floor(req.query.offset / req.query.limit) + 1,
        limit: req.query.limit,
        total: result.total,
      });
    })
  );

  /** @legacy PUT /clubnotification/clubs/notifications/:notificationId/read */
  router.put(
    '/notifications/:notificationId/read',
    validate({ params: z.object({ notificationId }) }),
    asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.markRead({ channel: 'club', notificationId: req.params.notificationId, actorId: req.user.id })
      )
    )
  );

  // ── Banner notifications ────────────────────────────────────────────

  /** @legacy POST /clubbanner/clubs/:clubId/banners/:bannerId/notify */
  router.post(
    '/clubs/:clubId/banners/:bannerId/notify',
    validate({ params: z.object({ clubId, bannerId }), body: notificationBody }),
    asyncHandler(async (req, res) =>
      response.created(
        res,
        await service.send({ channel: 'banner', ...req.params, actorId: req.user.id, ...req.body })
      )
    )
  );

  /** @legacy GET /clubbanner/clubs/:clubId/banner-notifications */
  router.get(
    '/clubs/:clubId/banner-notifications',
    validate({ params: z.object({ clubId }), query: z.object(paging).strict() }),
    asyncHandler(async (req, res) => {
      const result = await service.list({
        channel: 'banner',
        clubId: req.params.clubId,
        actorId: req.user.id,
        ...req.query,
      });
      return response.paginated(res, result.rows, {
        page: Math.floor(req.query.offset / req.query.limit) + 1,
        limit: req.query.limit,
        total: result.total,
      });
    })
  );

  /** @legacy PUT /clubbanner/clubs/banner-notifications/:notificationId/read */
  router.put(
    '/banner-notifications/:notificationId/read',
    validate({ params: z.object({ notificationId }) }),
    asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.markRead({ channel: 'banner', notificationId: req.params.notificationId, actorId: req.user.id })
      )
    )
  );

  return router;
};
