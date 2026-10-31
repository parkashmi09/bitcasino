'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../catalogue.validators');
const { CatalogueService } = require('../catalogue.service');
const { createControllers } = require('../controllers');
const { requireGameEntitled } = require('../../games/gameEntitlement');

/**
 * Launching a game.
 *
 * The loader attaches the player guard, so `req.user.id` is from a verified
 * token. Legacy's `/game_launch` and `/game_launch_new` had no middleware and
 * took `user_code` from the body — a session against any account.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new CatalogueService(deps) });
  const router = Router();

  // The owner's plan — see `games/gameEntitlement.js`.
  const entitled = requireGameEntitled(deps, (req) => ({ uid: req.body.gameCode, provider: req.body.providerCode }));

  /** @legacy POST /game_launch, /game_launch_new */
  router.post('/launch', validate(v.launch), entitled, ctrl.launch);

  return router;
};
