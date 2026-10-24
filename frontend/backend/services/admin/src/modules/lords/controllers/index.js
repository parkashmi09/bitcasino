'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * `canIssueFunds` is the platform owner's capability — the house is where money
 * enters, so a refill from that account is not drawn from a balance. Legacy
 * expressed it as `isOwner(req.staff)` and recorded the result no differently
 * from an agent moving their own float.
 */
const actorFrom = (req) => ({
  id: req.staff.id,
  level: req.staff.level,
  canIssueFunds: Number(req.staff.level) === 0,
});

function createControllers({ service, clients }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });
  const paged = async (res, q, promise) => {
    const result = await promise;
    return response.paginated(res, result.rows, { ...page(q), total: result.total });
  };

  return {
    /** @legacy POST /lords/user-setting/update-password */
    setPassword: asyncHandler(async (req, res) =>
      response.ok(res, await service.setPassword({ ...req.body, actor: actorFrom(req) }))
    ),

    /** @legacy POST /lords/user-setting/status */
    setStatus: asyncHandler(async (req, res) =>
      response.ok(res, await service.setStatus({ ...req.body, actor: actorFrom(req) }))
    ),

    /** @legacy POST /lords/user-setting/exposure-limit */
    setExposureLimit: asyncHandler(async (req, res) =>
      response.ok(res, await service.setExposureLimit({ ...req.body, actor: actorFrom(req) }))
    ),

    /** @legacy POST /lords/update-current */
    setCreditLimit: asyncHandler(async (req, res) =>
      response.ok(res, await service.setCreditLimit({ ...req.body, actor: actorFrom(req) }))
    ),

    /**
     * @legacy POST /lords/quick-refill
     * @legacy POST /lords/funds/transfer
     * @legacy POST /funds/transfer
     */
    refill: asyncHandler(async (req, res) =>
      response.created(res, await service.refill({ ...req.body, actor: actorFrom(req) }))
    ),

    /** @legacy GET /lords/transfer/statement */
    transferStatement: asyncHandler(async (req, res) =>
      paged(res, req.query, service.transferStatement({ ...req.query, actor: actorFrom(req) }))
    ),

    /**
     * @legacy GET /lords/users/all-details
     *
     * ═══════════════════════════════════════════════════════════════════════
     * THIS USED TO ANSWER IN LEGACY'S SHAPE, AND BY THE END NOTHING READ IT.
     *
     * It replied `{status: 'success', users, totalPages, totalCount}` because
     * the panel's downline table had been written against legacy and read
     * `users` off the top level. The note here said changing it meant changing
     * the panel in the same commit.
     *
     * The panel was changed — `getAllDetails` goes through `apiFetchPage`,
     * which unwraps `{success, data, meta.pagination}` — and this was not. So
     * the two moved in opposite directions and met nowhere: `body.data` was
     * `undefined`, `apiFetchPage` returned `[]` for a response that carried
     * three agents, and the table rendered "No agents found" with a 200 in the
     * network tab and nothing in the console.
     *
     * It answers in the platform envelope now, like every other list. The
     * socket reply in `../sockets.js` carries the same two keys for the same
     * reason.
     * ═══════════════════════════════════════════════════════════════════════
     */
    allDetails: asyncHandler(async (req, res) =>
      paged(res, req.query, service.allDetails({ ...req.query, actor: actorFrom(req) }))
    ),

    /** @legacy GET /lords/net-exposure/sports */
    netExposure: asyncHandler(async (req, res) =>
      response.ok(res, await service.netExposure({ actor: actorFrom(req), clients }))
    ),
  };
}

module.exports = { createControllers };
