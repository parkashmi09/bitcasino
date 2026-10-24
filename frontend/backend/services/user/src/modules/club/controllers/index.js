'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });
  const paged = async (res, q, promise) => {
    const result = await promise;
    return response.paginated(res, result.rows, { ...page(q), total: result.total });
  };

  return {
    // ── Players ───────────────────────────────────────────────────────

    /** @legacy POST /clubmembership/create */
    create: asyncHandler(async (req, res) =>
      response.created(res, await service.create({ ...req.body, ownerId: req.user.id }))
    ),

    /** @legacy PUT /clubmembership/update */
    update: asyncHandler(async (req, res) =>
      response.ok(res, await service.update({ ...req.body, clubId: req.params.clubId, actorId: req.user.id }))
    ),

    /** @legacy DELETE /clubmembership/:clubId/delete */
    remove: asyncHandler(async (req, res) =>
      response.ok(res, await service.remove({ clubId: req.params.clubId, actorId: req.user.id }))
    ),

    /** @legacy POST /clubmembership/join */
    join: asyncHandler(async (req, res) =>
      response.created(res, await service.join({ ...req.body, userId: req.user.id }))
    ),

    leave: asyncHandler(async (req, res) => response.ok(res, await service.leave({ userId: req.user.id }))),

    /** @legacy POST /clubmembership/change-role */
    changeRole: asyncHandler(async (req, res) =>
      response.ok(res, await service.changeRole({ ...req.body, actorId: req.user.id }))
    ),

    /** @legacy GET /clubmembership/user-affiliations/:userId */
    myMembership: asyncHandler(async (req, res) =>
      response.ok(res, await service.myMembership({ userId: req.user.id }))
    ),

    /** @legacy GET /clubmembership/profile/:clubId */
    getClub: asyncHandler(async (req, res) => response.ok(res, await service.getClub(req.params))),

    /** @legacy GET /clubmembership/:clubId/hierarchy */
    hierarchy: asyncHandler(async (req, res) => response.ok(res, await service.hierarchy(req.params))),

    /** @legacy GET /clubmembership/club_memberships/fetch */
    members: asyncHandler(async (req, res) =>
      paged(res, req.query, service.listMembers({ ...req.query, clubId: req.params.clubId }))
    ),

    /** @legacy PUT /clubmembership/earnings-config */
    setEarningsConfig: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.setEarningsConfig({ ...req.body, clubId: req.params.clubId, actorId: req.user?.id ?? null })
      )
    ),

    /** @legacy GET /clubmembership/club_earnings_configurations/fetch */
    earningsConfig: asyncHandler(async (req, res) =>
      response.ok(res, await service.earningsConfig(req.params))
    ),

    /** @legacy GET /clubmembership/club_earnings_log/fetch */
    earningsLog: asyncHandler(async (req, res) =>
      paged(res, req.query, service.earningsLog({ ...req.query, clubId: req.params.clubId }))
    ),

    /** @legacy GET /clubmembership/userprofile/:userId */
    ownerProfile: asyncHandler(async (req, res) =>
      response.ok(res, await service.ownerProfile({ ownerId: req.params.ownerId }))
    ),

    // ── Staff ─────────────────────────────────────────────────────────

    /** @legacy GET /clubmembership/clubs/fetch */
    listClubs: asyncHandler(async (req, res) => paged(res, req.query, service.listClubs(req.query))),

    /** Staff act on any club, so `actorId` is null. */
    adminUpdate: asyncHandler(async (req, res) =>
      response.ok(res, await service.update({ ...req.body, clubId: req.params.clubId, actorId: null }))
    ),

    adminRemove: asyncHandler(async (req, res) =>
      response.ok(res, await service.remove({ clubId: req.params.clubId, actorId: null }))
    ),

    adminSetEarningsConfig: asyncHandler(async (req, res) =>
      response.ok(res, await service.setEarningsConfig({ ...req.body, clubId: req.params.clubId, actorId: null }))
    ),
  };
}

module.exports = { createControllers };
