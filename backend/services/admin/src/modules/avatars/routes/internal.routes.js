'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');

const v = require('../avatars.validators');
const { AvatarsService } = require('../avatars.service');

/**
 * For user-service: the public list (its state sync socket carries it as `avatars`) and one
 * avatar's unlock level (`POST /user/profile/avatar` checks it against the player's VIP level).
 */
module.exports = function internalRoutes(deps) {
  const service = new AvatarsService(deps);
  const router = Router();
  router.get('/public', asyncHandler(async (_req, res) => response.ok(res, await service.publicList())));
  router.get('/:id', validate(v.byId), asyncHandler(async (req, res) => response.ok(res, await service.byId(req.params.id))));
  return router;
};
