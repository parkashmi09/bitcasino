'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * The actor is `req.staff` — from a verified token — with two capabilities
 * derived from the permissions on that token rather than from a hardcoded
 * level check inside a handler, which is what legacy used
 * (`req.staff.level !== 0`).
 */
function actorFrom(req) {
  return {
    id: req.staff.id,
    level: req.staff.level,
    canResetOthers: Boolean(req.staff.permissions?.includes('staff:write')),
    // The platform owner funds the tree and has no balance to draw down.
    canIssueFunds: Number(req.staff.level) === 0,
  };
}

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });
  const paged = async (res, q, promise) => {
    const result = await promise;
    return response.paginated(res, result.rows, { ...page(q), total: result.total });
  };

  return {
    /** @legacy GET /api/staff/tree */
    tree: asyncHandler(async (req, res) => response.ok(res, await service.tree({ actor: actorFrom(req) }))),

    /** @legacy GET /api/staff */
    list: asyncHandler(async (req, res) =>
      paged(res, req.query, service.list({ ...req.query, actor: actorFrom(req) }))
    ),

    /** @legacy GET /api/staff/players */
    listPlayers: asyncHandler(async (req, res) =>
      paged(res, req.query, service.listPlayers({ ...req.query, actor: actorFrom(req) }))
    ),

    /** @legacy GET /api/staff/:id */
    getById: asyncHandler(async (req, res) =>
      response.ok(res, await service.getById({ actor: actorFrom(req), staffId: req.params.staffId }))
    ),

    /** @legacy GET /api/staff/:id/percent-chain */
    percentChain: asyncHandler(async (req, res) =>
      response.ok(res, await service.percentChain({ actor: actorFrom(req), staffId: req.params.staffId }))
    ),

    /** @legacy GET /api/staff/:id/percent-tree */
    percentTree: asyncHandler(async (req, res) =>
      response.ok(res, await service.percentTree({ actor: actorFrom(req), staffId: req.params.staffId }))
    ),

    /**
     * @legacy GET /api/staff/transactions
     * @legacy GET /api/staff/transfers/:id?
     *
     * Three routes share this handler and they name the account differently:
     * `/transfers/:staffId` puts it in the path, `/transfers` and
     * `/transactions` take it as `?staffId=`. The path segment wins where it
     * exists — without this the `/transfers/:staffId` route parsed the id and
     * then listed the caller's ENTIRE subtree, because only `req.query` was
     * forwarded.
     */
    transfers: asyncHandler(async (req, res) =>
      paged(
        res,
        req.query,
        service.transfers({
          ...req.query,
          ...(req.params.staffId !== undefined ? { staffId: req.params.staffId } : {}),
          actor: actorFrom(req),
        })
      )
    ),

    /**
     * @legacy GET /api/staff/transfers/summary
     * @legacy GET /api/staff/transfers/summary/:id
     */
    transferSummary: asyncHandler(async (req, res) =>
      response.ok(res, await service.transferSummary({ ...req.query, actor: actorFrom(req) }))
    ),

    /**
     * @legacy GET /api/staff/rollup/:id
     * @legacy GET /api/staff/rollupStaff/:id
     * @legacy GET /api/staff/metrics/:id
     */
    rollup: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.rollup({
          actor: actorFrom(req),
          staffId: req.params.staffId,
          includeSubtree: req.query.includeSubtree,
        })
      )
    ),

    /** @legacy GET /api/staff/analytics/:id */
    analytics: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.analytics({ actor: actorFrom(req), staffId: req.params.staffId, days: req.query.days })
      )
    ),

    /** @legacy GET /api/staff/:id/whatsapp-ref */
    whatsappRef: asyncHandler(async (req, res) =>
      response.ok(res, await service.whatsappRef({ actor: actorFrom(req), staffId: req.params.staffId }))
    ),

    // ── Writes ────────────────────────────────────────────────────────

    /** @legacy POST /api/staff */
    create: asyncHandler(async (req, res) =>
      response.created(res, await service.create({ ...req.body, actor: actorFrom(req) }))
    ),

    /** @legacy PATCH /api/staff/:id */
    update: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.update({ ...req.body, actor: actorFrom(req), staffId: req.params.staffId })
      )
    ),

    /** @legacy POST /api/staff/transfer */
    transfer: asyncHandler(async (req, res) =>
      response.created(res, await service.transfer({ ...req.body, actor: actorFrom(req) }))
    ),

    /**
     * @legacy PATCH /api/staff/password
     * @legacy POST /api/staff/reset-password-for-staff
     */
    changePassword: asyncHandler(async (req, res) =>
      response.ok(res, await service.changePassword({ ...req.body, actor: actorFrom(req) }))
    ),

    /** @legacy DELETE /api/staff/:id */
    remove: asyncHandler(async (req, res) =>
      response.ok(res, await service.remove({ actor: actorFrom(req), staffId: req.params.staffId }))
    ),

    /** @legacy POST /api/staff/patch-bulk-status */
    bulkStatus: asyncHandler(async (req, res) =>
      response.ok(res, await service.bulkStatus({ ...req.body, actor: actorFrom(req) }))
    ),
  };
}

module.exports = { createControllers };
