'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });

  return {
    // ── Players ───────────────────────────────────────────────────────

    /** @legacy GET /giftCard/user/:userId/active-with-status */
    mine: asyncHandler(async (req, res) => response.ok(res, await service.listForUser({ userId: req.user.id }))),

    /** @legacy POST /giftCard/activate */
    activate: asyncHandler(async (req, res) =>
      response.created(res, await service.activate({ ...req.body, userId: req.user.id }))
    ),

    /** @legacy POST /giftCard/claim */
    claim: asyncHandler(async (req, res) =>
      response.ok(res, await service.claim({ ...req.body, userId: req.user.id }))
    ),

    /** @legacy GET /giftCard/user/:userId/claimed */
    myClaimed: asyncHandler(async (req, res) => {
      const result = await service.listClaimed({ ...req.query, userId: req.user.id });
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total });
    }),

    // ── Staff ─────────────────────────────────────────────────────────

    /** @legacy POST /giftCard/admin/create */
    create: asyncHandler(async (req, res) => response.created(res, await service.create(req.body))),

    /** @legacy GET /giftCard/admin/list */
    list: asyncHandler(async (req, res) => {
      const result = await service.list(req.query);
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total });
    }),

    /** @legacy DELETE /giftCard/admin/delete/:id */
    remove: asyncHandler(async (req, res) => response.ok(res, await service.remove(req.params))),

    /** @legacy POST /giftCard/search */
    search: asyncHandler(async (req, res) => response.ok(res, await service.findByKey(req.body))),

    /** @legacy GET /giftCard/admin/analytics */
    analytics: asyncHandler(async (_req, res) => response.ok(res, await service.analytics())),

    /** @legacy GET /giftCard/admin/records */
    records: asyncHandler(async (req, res) => {
      const result = await service.records(req.query);
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total });
    }),
  };
}

module.exports = { createControllers };
