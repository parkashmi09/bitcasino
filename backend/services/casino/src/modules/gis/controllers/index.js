'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    // ── Provider callback ─────────────────────────────────────────────

    /**
     * @legacy POST /api/gis/callback/transactions
     *
     * ALWAYS HTTP 200, even for a refusal. Slotegrator's client cannot parse
     * our error envelope and retries on anything it cannot parse, so a 4xx here
     * is an infinite retry loop against a money endpoint.
     */
    callback: asyncHandler(async (req, res) =>
      res.status(200).json(await service.handleTransaction({ body: req.body, headers: req.headers }))
    ),

    // ── Play ──────────────────────────────────────────────────────────

    /** @legacy POST /api/gis/games/init — took `player_id` from the body */
    launch: asyncHandler(async (req, res) =>
      response.created(res, await service.launch({ ...req.body, userId: req.user.id }))
    ),

    /** @legacy POST /api/gis/games/init-demo */
    launchDemo: asyncHandler(async (req, res) => response.created(res, await service.launchDemo(req.body))),

    /** @legacy GET /api/gis/games/lobby */
    lobby: asyncHandler(async (req, res) => response.ok(res, await service.lobby(req.query))),

    // ── Upstream reads ────────────────────────────────────────────────

    /** @legacy GET /api/gis/limits */
    limits: asyncHandler(async (_req, res) => response.ok(res, await service.limits())),

    /** @legacy GET /api/gis/limits/freespin */
    freespinLimits: asyncHandler(async (_req, res) => response.ok(res, await service.freespinLimits())),

    /** @legacy GET /api/gis/jackpots */
    jackpots: asyncHandler(async (_req, res) => response.ok(res, await service.jackpots())),

    /** @legacy GET /api/gis/game-tags — 500 on every request */
    gameTags: asyncHandler(async (req, res) => response.ok(res, await service.gameTags(req.query))),

    /** @legacy GET /api/gis/freespins/bets */
    freespinBets: asyncHandler(async (req, res) => response.ok(res, await service.freespinBets(req.query))),

    /**
     * The caller's own active freespin campaigns. `req.user.id` and never a
     * body or query parameter — this is the read `POST /games/init` got wrong
     * in the other direction, where a `player_id` in the body opened a session
     * on any named account.
     */
    listMyFreespins: asyncHandler(async (req, res) =>
      response.ok(res, await service.listMyFreespins({ userId: req.user.id }))
    ),

    /** @legacy GET /api/gis/self-validate */
    selfValidate: asyncHandler(async (_req, res) => response.ok(res, await service.selfValidate())),

    // ── Freespins ─────────────────────────────────────────────────────

    /** @legacy POST /api/gis/freespins/set — `gis_freespins` never existed */
    setFreespin: asyncHandler(async (req, res) => response.created(res, await service.setFreespin(req.body))),

    /** @legacy GET /api/gis/freespins/get */
    getFreespin: asyncHandler(async (req, res) => response.ok(res, await service.getFreespin(req.query))),

    /** @legacy POST /api/gis/freespins/cancel */
    cancelFreespin: asyncHandler(async (req, res) => response.ok(res, await service.cancelFreespin(req.body))),

    // ── Vouchers ──────────────────────────────────────────────────────

    /** @legacy POST /api/gis/freevouchers/set — `gis_freevouchers` never existed */
    setVoucher: asyncHandler(async (req, res) => response.created(res, await service.setVoucher(req.body))),

    /** @legacy GET /api/gis/freevouchers/get */
    getVoucher: asyncHandler(async (req, res) => response.ok(res, await service.getVoucher(req.query))),

    /** @legacy POST /api/gis/freevouchers/cancel */
    cancelVoucher: asyncHandler(async (req, res) => response.ok(res, await service.cancelVoucher(req.body))),

    // ── Sync ──────────────────────────────────────────────────────────

    /** @legacy GET /api/gis/sync/gamesnew (and GET /api/gis/sync) */
    syncGames: asyncHandler(async (_req, res) => response.ok(res, await service.syncGames())),

    /** @legacy GET /api/gis/sync/providersnew — truncated the enable flags */
    syncProviders: asyncHandler(async (_req, res) => response.ok(res, await service.syncProviders())),
  };
}

module.exports = { createControllers };
