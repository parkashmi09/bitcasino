'use strict';

const { Router } = require('express');
const { noQuery, response, asyncHandler } = require('@ibitplay/common');

const { access } = require('../liveTv.service');

/** The signed-in player's own Live TV access (never anyone else's: the id is the token's). */
module.exports = function userRoutes(deps) {
  const router = Router();
  router.get('/access', noQuery(), asyncHandler(async (req, res) => response.ok(res, await access(deps.db, req.user.id))));
  return router;
};
