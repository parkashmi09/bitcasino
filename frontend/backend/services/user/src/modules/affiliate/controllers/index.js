'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });
  const paged = async (res, q, promise) => {
    const result = await promise;
    return response.paginated(res, result.rows ?? result.members, { ...page(q), total: result.total });
  };

  return {
    // ── Players ───────────────────────────────────────────────────────

    /** @legacy GET /affiliate/referral-info/:userId */
    referralInfo: asyncHandler(async (req, res) =>
      response.ok(res, await service.referralInfo({ userId: req.user.id }))
    ),

    /** @legacy GET /affiliate/team/:referralCode */
    myTeam: asyncHandler(async (req, res) =>
      response.ok(res, await service.myTeam({ ...req.query, userId: req.user.id }))
    ),

    /**
     * @legacy GET /affiliate/rewards/:referralCode
     * @legacy GET /api/rewards/:uid
     *
     * The player comes from the token. Legacy's two versions named them with a
     * public referral code and a raw `uid` in the URL, both unauthenticated.
     */
    myRewards: asyncHandler(async (req, res) =>
      response.ok(res, await service.myRewards({ ...req.query, userId: req.user.id }))
    ),

    /** @legacy GET /affiliate/unclaimed-rewards/:uid */
    unclaimed: asyncHandler(async (req, res) =>
      response.ok(res, await service.unclaimedRewards({ userId: req.user.id }))
    ),

    /** @legacy POST /affiliate/claim-reward */
    claim: asyncHandler(async (req, res) =>
      response.ok(res, await service.claimReward({ ...req.body, userId: req.user.id }))
    ),

    /** @legacy POST /affiliate/claim-reward-all */
    claimAll: asyncHandler(async (req, res) =>
      response.ok(res, await service.claimAllRewards({ userId: req.user.id }))
    ),

    /** @legacy POST /affiliate/team/add */
    joinTeam: asyncHandler(async (req, res) =>
      response.created(res, await service.joinTeam({ ...req.body, userId: req.user.id }))
    ),

    // ── Staff ─────────────────────────────────────────────────────────

    /** @legacy GET /affiliateAdmin/teams */
    listTeams: asyncHandler(async (req, res) => paged(res, req.query, service.listTeams(req.query))),

    /** @legacy GET /affiliateAdmin/teams/:teamId/members */
    teamMembers: asyncHandler(async (req, res) =>
      paged(res, req.query, service.teamMembers({ ...req.query, owner: req.params.owner }))
    ),

    /** @legacy GET /affiliateAdmin/users-with-teams */
    usersWithTeams: asyncHandler(async (req, res) => paged(res, req.query, service.usersWithTeams(req.query))),

    /** @legacy GET /affiliateAdmin/dashboard-stats */
    stats: asyncHandler(async (_req, res) => response.ok(res, await service.dashboardStats())),

    /** @legacy GET /affiliateAdmin/rewards-list */
    listRewards: asyncHandler(async (req, res) => paged(res, req.query, service.listRewards(req.query))),


    /** @legacy GET /affiliateAdmin/top-affiliates */
    topAffiliates: asyncHandler(async (req, res) => response.ok(res, await service.topAffiliates(req.query))),

    /** @legacy POST /affiliate/process-wager */
    unlock: asyncHandler(async (req, res) =>
      response.ok(res, await service.unlockFor({ ...req.body, staffId: req.staff?.id }))
    ),

    /** @legacy POST /affiliate/rewards/record */
    recordReward: asyncHandler(async (req, res) => response.created(res, await service.recordReward(req.body))),
  };
}

module.exports = { createControllers };
