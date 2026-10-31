'use strict';

const { Router } = require('express');
const { validate, noBody, noQuery, createRateLimiter } = require('@ibitplay/common');

const v = require('../auth.validators');
const refreshCookie = require('../refreshCookie');
const { AuthService } = require('../auth.service');
const { createUserController } = require('../controllers/user.controller');

/** Session management for a signed-in player. */
module.exports = function userRoutes(deps) {
  const service = new AuthService(deps);
  const ctrl = createUserController({ service });

  const router = Router();

  router.get('/me', noQuery(), ctrl.me);
  router.get('/sessions', noQuery(), ctrl.sessions);
  router.post('/logout', refreshCookie.fromCookie, validate(v.logout), ctrl.logout);
  // Idle logout: the player site's heartbeat while the player interacts (it sends ≤ 1 a minute;
  // background polling never calls it), and the check it makes once its own idle timer runs out.
  const activityLimiter = createRateLimiter({
    name: 'auth:activity',
    windowMs: 60_000,
    max: 6,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });
  router.post('/activity', noBody(), activityLimiter, ctrl.activity);
  router.post('/idle-check', noBody(), ctrl.idleCheck);
  router.post('/change-password', validate(v.changePassword), ctrl.changePassword);
  /**
   * The Remove button on Settings -> Security. `GET /sessions` shipped with the
   * port; nothing could act on what it returned, and `change-password` — which
   * ends ALL sessions — was the only thing in the module that revoked anything.
   */
  router.delete('/sessions/:sessionId', noBody(), validate(v.revokeSession), ctrl.revokeSession);

  return router;
};
