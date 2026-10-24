'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * Player-facing settlement handlers.
 *
 * New surface — legacy exposed settlement only to staff, so a player had no way
 * to see why a bet was voided. These use the platform response envelope rather
 * than the legacy `{ success, data }` shape, because no existing client parses
 * them.
 *
 * The user id comes from `req.user.id` (set by the verified token), never from
 * a query parameter. That is the difference between "my settled bets" and "any
 * user's settled bets if you know their id".
 */
function createUserController({ service }) {
  return {
    listMySettledBets: asyncHandler(async (req, res) => {
      const { limit, offset, match_id: matchId, game_type: gameType } = req.query;

      const result = await service.listSettledBetsForUser({
        userId: req.user.id,
        matchId,
        gameType,
        limit,
        offset,
      });

      const page = Math.floor(offset / limit) + 1;
      return response.paginated(res, result, { page, limit });
    }),
  };
}

module.exports = { createUserController };
