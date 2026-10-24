'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../bets.validators');
const { BetsService } = require('../bets.service');
const { createControllers } = require('../controllers');

/**
 * A player's own betting.
 *
 * Every route here was unauthenticated in legacy and named the player in the
 * URL or the request body — including the one that takes their money.
 *
 * No `FeedClient` here any more. The ported handler prices against the CACHED
 * book — `oddsData:<gmid>`, which the `feed:odds` job refreshes every two
 * seconds — exactly as legacy's `verifyBetAgainstLiveOdds` did, so what it
 * needs from the container is `cache`, not an upstream client. A live fetch on
 * the bet path would be a provider round trip inside the money transaction.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new BetsService(deps) });

  const router = Router();

  router.post('/', validate(v.place), ctrl.place);

  router.get('/', validate(v.history), ctrl.history);
  router.get('/summary', ctrl.summary);
  router.get('/open-count', ctrl.openCount);
  router.get('/exposures', validate(v.exposures), ctrl.exposures);
  router.get('/open/:matchId', validate(v.matchParam), ctrl.openBets);

  return router;
};
