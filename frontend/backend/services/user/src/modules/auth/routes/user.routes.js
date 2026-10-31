'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../auth.validators');
const { AuthService } = require('../auth.service');
const { createUserController } = require('../controllers/user.controller');

/** Session management for a signed-in player. */
module.exports = function userRoutes(deps) {
  const service = new AuthService(deps);
  const ctrl = createUserController({ service });

  const router = Router();

  router.get('/me', ctrl.me);
  router.get('/sessions', ctrl.sessions);
  router.post('/logout', validate(v.logout), ctrl.logout);
  router.post('/change-password', validate(v.changePassword), ctrl.changePassword);

  return router;
};
