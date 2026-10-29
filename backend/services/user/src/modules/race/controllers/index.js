'use strict';

const { response, asyncHandler } = require('@ibitplay/common');
const { hidePrivateNames } = require('../racePrivacy');

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });

  return {
    // ── Public ────────────────────────────────────────────────────────

    /**
     * Both races and their on/off state, in one request.
     *
     * The whole feature's visibility hangs off this, so a front end asks once
     * rather than probing each race and inferring "off" from a 404.
     */
    configs: asyncHandler(async (_req, res) => response.ok(res, await service.listConfigs())),

    /**
     * Standings.
     *
     * Public, but reads the session when there is one: `req.user` is populated
     * by the gateway's token check on any request that carries a token, and a
     * signed-in player wants their own rank whether or not they are winning.
     */
    leaderboard: asyncHandler(async (req, res) => {
      const board = await service.leaderboard({ type: req.params.type, userId: req.user?.id ?? null });
      // rainbet: players who keep their bets private are not named on the public board.
      return response.ok(res, await hidePrivateNames(service.models, board, req.user?.id));
    }
    ),

    /** The previous window's standings (Last Champion, History). */
    last: asyncHandler(async (req, res) => response.ok(res, await service.lastLeaderboard({ type: req.params.type }))),

    /** Finished races with their podium; a caller with a token also gets their own placing. */
    history: asyncHandler(async (req, res) =>
      response.ok(res, await service.history({ ...req.query, userId: req.user?.id ?? null }))
    ),

    // ── Players ───────────────────────────────────────────────────────

    myRewards: asyncHandler(async (req, res) => {
      const result = await service.myRewards({ ...req.query, userId: req.user.id });
      return response.paginated(res, result.rows, {
        ...page(req.query),
        total: result.total,
        unclaimedTotal: result.unclaimedTotal,
        unclaimedCount: result.unclaimedCount,
        currency: result.currency,
      });
    }),

    claim: asyncHandler(async (req, res) =>
      response.ok(res, await service.claim({ userId: req.user.id, rewardId: req.params.rewardId }))
    ),

    // ── Staff ─────────────────────────────────────────────────────────

    getConfig: asyncHandler(async (req, res) => response.ok(res, await service.getConfig(req.params))),

    updateConfig: asyncHandler(async (req, res) =>
      response.ok(res, await service.updateConfig({ type: req.params.type, ...req.body }))
    ),

    listRaces: asyncHandler(async (req, res) => {
      const result = await service.listRaces(req.query);
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total });
    }),

    listRewards: asyncHandler(async (req, res) => {
      const result = await service.listRewards(req.query);
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total }, { summary: result.summary });
    }),

    /**
     * Settle now, rather than waiting for the window to close.
     *
     * The manual path and the automatic one call the SAME method — which is why
     * settlement lives in the service and not in the worker. The reference kept
     * the payout maths in its cron and a second copy elsewhere, and the two
     * drifted.
     */
    settle: asyncHandler(async (req, res) => response.ok(res, await service.settle({ raceId: req.params.id }))),

    cancel: asyncHandler(async (req, res) =>
      response.ok(res, await service.cancel({ raceId: req.params.id, reason: req.body?.reason ?? null }))
    ),

    startTestRace: asyncHandler(async (req, res) => response.created(res, await service.startTestRace(req.body))),

    /** Staff view of the open board: the same standings players see, real ids included. */
    adminLeaderboard: asyncHandler(async (req, res) => response.ok(res, await service.leaderboard({ type: req.params.type }))),

    listBoats: asyncHandler(async (_req, res) => response.ok(res, await service.listBoats())),
    addBoat: asyncHandler(async (req, res) => response.created(res, await service.addBoat(req.body))),
    updateBoat: asyncHandler(async (req, res) =>
      response.ok(res, await service.updateBoat({ id: req.params.id, ...req.body }))
    ),
    removeBoat: asyncHandler(async (req, res) => response.ok(res, await service.removeBoat(req.params))),
  };
}

module.exports = { createControllers };
