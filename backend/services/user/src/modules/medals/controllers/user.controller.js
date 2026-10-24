'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createUserController({ service }) {
  return {
    /** The caller's own medals — the id is the token's, never the request's. */
    mine: asyncHandler(async (req, res) => response.ok(res, await service.forPlayer(req.user.id))),
  };
}

module.exports = { createUserController };
