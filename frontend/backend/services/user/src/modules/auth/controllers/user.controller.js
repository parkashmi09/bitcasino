'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/** Endpoints that act on the caller's own session. */
function createUserController({ service }) {
  return {
    me: asyncHandler(async (req, res) => {
      return response.ok(res, await service.me(req.user.id));
    }),

    logout: asyncHandler(async (req, res) => {
      const result = await service.logout(req.body, req.user);
      return response.ok(res, result);
    }),

    changePassword: asyncHandler(async (req, res) => {
      const result = await service.changePassword(req.body, req.user);
      return response.ok(res, {
        ...result,
        message: 'Password changed. All other sessions have been signed out.',
      });
    }),

    sessions: asyncHandler(async (req, res) => {
      return response.ok(res, await service.listSessions(req.user.id));
    }),
  };
}

module.exports = { createUserController };
