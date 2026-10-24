'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    /** @legacy GET /sportsbooks */
    list: asyncHandler(async (_req, res) => response.ok(res, await service.list())),

    /**
     * @legacy POST /sportsbooks/init
     *
     * `userId` from the token. Legacy read `player_id` from the body on a route
     * with no auth, so this one line is the difference between a session on the
     * caller's account and a session on anyone's.
     */
    init: asyncHandler(async (req, res) =>
      response.created(
        res,
        await service.init({
          ...req.body,
          userId: req.user.id,
          ipAddress: req.ip,
        })
      )
    ),

    /** @legacy POST /sportsbooks/refresh-token — which was init under another name */
    refresh: asyncHandler(async (req, res) =>
      response.ok(res, await service.refresh({ sessionId: req.body.sessionId, userId: req.user.id }))
    ),

    /** @legacy POST /sportsbooks/logout — took the provider token from the body */
    logout: asyncHandler(async (req, res) =>
      response.ok(res, await service.logout({ sessionId: req.body.sessionId, userId: req.user.id }))
    ),

    /** Not a legacy endpoint — legacy stored no sessions to list. */
    sessions: asyncHandler(async (req, res) => response.ok(res, await service.sessions({ userId: req.user.id }))),
  };
}

module.exports = { createControllers };
