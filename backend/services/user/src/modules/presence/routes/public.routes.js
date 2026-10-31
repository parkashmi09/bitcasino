'use strict';

const { Router } = require('express');
const { response, asyncHandler } = require('@ibitplay/common');

const { PresenceService } = require('../presence.service');

/**
 * The connected count.
 *
 * PUBLIC, and deliberately: the figure sits beside a chat feed that a
 * signed-out visitor can already read, and on the lobby tiles they see before
 * they have an account. Requiring a token would mean the number only appears
 * once you are counted in it.
 *
 * It carries no identities — a count, a scope, and nothing that says WHO. That
 * is the whole reason it can be public.
 */
module.exports = function publicRoutes(deps) {
  const service = new PresenceService(deps);
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => response.ok(res, service.count()))
  );

  return router;
};
