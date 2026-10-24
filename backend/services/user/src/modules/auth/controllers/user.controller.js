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

    /**
     * Sign one device out. The list above has been readable since the port
     * with nothing to act on it — this is the Remove button on each row.
     *
     * Removing the device you are CALLING FROM is allowed and works: the row
     * is revoked, and the next request on that token fails the session check.
     * That is the same outcome as `logout` and needs no special case, so there
     * is none.
     */
    revokeSession: asyncHandler(async (req, res) => {
      const result = await service.revokeSession(req.user.id, req.params.sessionId);
      return response.ok(res, result);
    }),
  };
}

module.exports = { createUserController };
