'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  const paged = (req, res, result) =>
    response.paginated(res, result.rows, {
      page: req.query.page,
      limit: req.query.per_page,
      total: result.total,
    });

  return {
    // ── v1 (huidu.bet) ────────────────────────────────────────────────

    /** @legacy POST /jsGames/game/launch — took `user_id` from the body */
    launchV1: asyncHandler(async (req, res) =>
      response.created(res, await service.launchV1({ ...req.body, userId: req.user.id }))
    ),

    /**
     * @legacy POST /jsGames/game/bet-callback
     *
     * ALWAYS HTTP 200 in the provider's envelope, refusals included — it
     * retries on anything it cannot parse, and this is a money endpoint.
     */
    betCallbackV1: asyncHandler(async (req, res) => res.status(200).json(await service.betCallbackV1(req.body))),

    /** @legacy POST /jsGames/game/transfer — unauthenticated, never debited us */
    transferV1: asyncHandler(async (req, res) =>
      response.ok(res, await service.transferV1({ ...req.body, actor: req.staff }))
    ),

    /** @legacy POST /jsGames/game/transactions — unauthenticated */
    transactionsV1: asyncHandler(async (req, res) => response.ok(res, await service.transactionsV1(req.body))),

    /** @legacy GET /jsGames/games */
    listGamesV1: asyncHandler(async (req, res) => paged(req, res, await service.listGamesV1(req.query))),

    /** @legacy GET /jsGames/games/search */
    searchGamesV1: asyncHandler(async (req, res) => paged(req, res, await service.searchGamesV1(req.query))),

    // ── v2 (games.ibitplay.com) ───────────────────────────────────────

    /** @legacy POST /jsGamesv2/launch — took `user_id` from the body */
    launchV2: asyncHandler(async (req, res) =>
      response.created(res, await service.launchV2({ ...req.body, userId: req.user.id }))
    ),

    /**
     * @legacy POST /jsGamesv2/bet-callback
     *
     * The one that wrote a balance taken straight from the request body, with
     * no authentication of any kind.
     */
    betCallbackV2: asyncHandler(async (req, res) =>
      res.status(200).json(await service.betCallbackV2({ body: req.body, headers: req.headers }))
    ),

    /** @legacy GET /jsGamesv2/games */
    listGamesV2: asyncHandler(async (req, res) => response.ok(res, await service.listGamesV2(req.query))),

    /** @legacy GET /jsGamesv2/games/search */
    searchGamesV2: asyncHandler(async (req, res) => response.ok(res, await service.searchGamesV2(req.query))),

    /** @legacy GET /jsGamesv2/history?userid= — took any id */
    historyV2: asyncHandler(async (req, res) => response.ok(res, await service.historyV2({ userId: req.user.id }))),

    /** @legacy GET /jsGamesv2/historyAdmin */
    historyAllV2: asyncHandler(async (_req, res) => response.ok(res, await service.historyAllV2())),
  };
}

module.exports = { createControllers };
