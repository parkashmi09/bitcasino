'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

const { EXECUTIVE_KIND } = require('../access.constants');

/**
 * The actor, with the permissions their token actually resolved to.
 *
 * `req.staff.permissions` is the EFFECTIVE set — `resolvePermissions` has
 * already intersected any executive grant with the parent's authority — which
 * is what makes the escalation check in the service meaningful. An executive
 * cannot use its own oversized stored grant to mint a second one.
 */
const actorFrom = (req) => ({
  id: req.staff.id,
  level: req.staff.level,
  executiveId: req.staff.executiveId ?? req.staff.executive_id ?? null,
  permissions: req.staff.permissions ?? [],
});

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });
  const paged = async (res, q, promise) => {
    const result = await promise;
    return response.paginated(res, result.rows, { ...page(q), total: result.total });
  };

  return {
    /** @legacy GET /lords/access/me/permissions */
    myPermissions: asyncHandler(async (req, res) =>
      response.ok(res, await service.myPermissions({ actor: actorFrom(req) }))
    ),

    /** @legacy GET /lords/access/executives */
    listExecutives: asyncHandler(async (req, res) =>
      paged(res, req.query, service.listExecutives({ ...req.query, actor: actorFrom(req) }))
    ),

    /** @legacy GET /lords/access/marketing-users */
    listMarketingUsers: asyncHandler(async (req, res) =>
      paged(res, req.query, service.listMarketingUsers({ ...req.query, actor: actorFrom(req) }))
    ),

    /** @legacy POST /lords/access/executives */
    createExecutive: asyncHandler(async (req, res) =>
      response.created(res, await service.createExecutive({ ...req.body, actor: actorFrom(req) }))
    ),

    /** @legacy POST /lords/access/marketing-users */
    createMarketingUser: asyncHandler(async (req, res) =>
      response.created(
        res,
        await service.createExecutive({ ...req.body, actor: actorFrom(req), kind: EXECUTIVE_KIND.MARKETING })
      )
    ),

    /** @legacy PATCH /lords/access/executives/:id */
    updateExecutive: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.updateExecutive({
          ...req.body, actor: actorFrom(req), executiveId: req.params.executiveId,
        })
      )
    ),

    /**
     * @legacy PATCH /lords/access/executives/:id/password
     * @legacy PATCH /lords/access/marketing-users/:id/password
     */
    resetPassword: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.resetPassword({
          ...req.body, actor: actorFrom(req), executiveId: req.params.executiveId,
        })
      )
    ),

    /**
     * @legacy PATCH /lords/access/executives/:id/lock
     * @legacy PATCH /lords/access/marketing-users/:id/lock
     */
    setStatus: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.setStatus({
          ...req.body, actor: actorFrom(req), executiveId: req.params.executiveId,
        })
      )
    ),

    /** @legacy GET /lords/access/executives/:id/activity */
    executiveActivity: asyncHandler(async (req, res) =>
      paged(
        res,
        req.query,
        service.executiveActivity({ ...req.query, actor: actorFrom(req), executiveId: req.params.executiveId })
      )
    ),

    /** @legacy GET /lords/access/activity */
    activity: asyncHandler(async (req, res) =>
      paged(res, req.query, service.activity({ ...req.query, actor: actorFrom(req) }))
    ),
  };
}

module.exports = { createControllers };
