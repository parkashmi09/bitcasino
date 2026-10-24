'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/** Every handler takes the user id from the verified token, never from input. */
function createControllers({ service }) {
  return {
    /** @legacy GET /2fa/status/:uid */
    status: asyncHandler(async (req, res) => response.ok(res, await service.status(req.user.id))),

    /** @legacy POST /2fa/enable */
    beginSetup: asyncHandler(async (req, res) =>
      response.ok(res, await service.beginSetup(req.user.id, { label: req.account?.name || req.account?.email }))
    ),

    /** @legacy POST /2fa/setup-verify */
    completeSetup: asyncHandler(async (req, res) =>
      response.ok(res, await service.completeSetup(req.user.id, req.body))
    ),

    /** @legacy POST /2fa/verify */
    verify: asyncHandler(async (req, res) => response.ok(res, await service.verify(req.user.id, req.body))),

    /** @legacy POST /2fa/disable */
    disable: asyncHandler(async (req, res) => response.ok(res, await service.disable(req.user.id, req.body))),
  };
}

module.exports = { createControllers };
