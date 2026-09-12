'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/** Unauthenticated auth endpoints — the ones that MINT a session. */
function createPublicController({ service }) {
  const context = (req) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

  return {
    register: asyncHandler(async (req, res) => {
      const result = await service.registerAndSignIn(req.body, context(req));
      // 201: the account is new. The session in the body is what makes this
      // one round trip instead of two.
      return response.created(res, result);
    }),

    login: asyncHandler(async (req, res) => {
      const result = await service.login(req.body, context(req));
      return response.ok(res, result);
    }),

    refresh: asyncHandler(async (req, res) => {
      const result = await service.refresh(req.body, context(req));
      return response.ok(res, result);
    }),
  };
}

module.exports = { createPublicController };
