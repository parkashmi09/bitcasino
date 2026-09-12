'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });

  return {
    /**
     * @legacy POST /sportsbetting/place
     * @legacy POST /api/sportsmain/place-bet
     * @legacy POST /bets
     *
     * Answers exactly what legacy's handler answered, and nothing else:
     *
     *   200 `{success, exposure, balanceDelta, oldBalance, newBalance, totalExposure}`
     *   403 `{success:false, message}` / `{success:false, code, message}`
     *   400 `{success:false, message}` — everything that threw
     *
     * So this route does NOT go through `response.*` or the shared error
     * handler. It is the one place in the service that hand-rolls its envelope,
     * because the board on the other end parses the legacy one.
     *
     * The player is `req.user.id`. Legacy read `user_id` from the body on an
     * unauthenticated route, so a bet could be placed against anyone's wallet;
     * the field may still arrive and is overwritten here.
     */
    place: async (req, res) => {
      try {
        const { status, body } = await service.place({
          ...req.body,
          user_id: req.user.id,
          // @legacy req.headers['x-forwarded-for']?.split(',')[0]
          //           || req?.connection?.remoteAddress || req.ip
          ip_address:
            req.headers['x-forwarded-for']?.split(',')[0] || req.connection?.remoteAddress || req.ip,
        });
        return res.status(status).json(body);
      } catch (error) {
        // @legacy catch → res.status(400).json({success:false, message})
        return res.status(400).json({ success: false, message: error.message });
      }
    },

    /**
     * @legacy GET /sportsbetting/open/:userUuid/:matchId
     * @legacy GET /api/sportsmain/open/:user_id/:match_id
     */
    openBets: asyncHandler(async (req, res) =>
      response.ok(res, await service.openBets({ userId: req.user.id, matchId: req.params.matchId }))
    ),

    /**
     * @legacy GET /sportsbetting/history/:userUuid
     * @legacy GET /api/sportsmain/history/:user_id/:match_id
     * @legacy GET /users/:userId/bets
     * @legacy GET /api/sportsmain/user-open-bets
     * @legacy GET /api/sportsmain/user-sports-open-bets
     */
    history: asyncHandler(async (req, res) => {
      const result = await service.history({ ...req.query, userId: req.user.id });
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total });
    }),

    /** The player's own bet and win counts, for their profile panel. */
    summary: asyncHandler(async (req, res) =>
      response.ok(res, await service.summary({ userId: req.user.id }))
    ),

    /**
     * @legacy GET /sportsbetting/opencount/:userUuid
     * @legacy GET /api/sportsmain/opencount/:user_id
     */
    openCount: asyncHandler(async (req, res) =>
      response.ok(res, await service.openCount({ userId: req.user.id }))
    ),

    /**
     * @legacy GET /sportsbetting/exposures/:user_id
     * @legacy GET /api/sportsmain/exposures/:user_id
     * @legacy GET /api/sportsmain/bets/exposure/:user_id
     * @legacy POST /api/sportsmain/matchexposures/match
     */
    exposures: asyncHandler(async (req, res) =>
      response.ok(res, await service.exposures({ userId: req.user.id, matchId: req.query.matchId }))
    ),
  };
}

module.exports = { createControllers };
