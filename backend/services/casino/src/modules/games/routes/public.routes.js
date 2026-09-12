'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../games.validators');
const { GamesService } = require('../games.service');
const { createControllers } = require('../controllers');

/**
 * The lobby. Genuinely public: a game catalogue is what an anonymous visitor
 * comes to look at, and none of these reads touch a player or a balance.
 */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: new GamesService(deps) });
  const router = Router();

  /** @legacy GET /api/gis/gamesgis */
  router.get('/', validate(v.browse), ctrl.browse);
  /** @legacy GET /api/gis/gamesgis/provider/:provider */
  router.get('/provider/:provider', validate(v.byProvider), ctrl.byProvider);
  /** @legacy GET /api/gis/gamesgis/stats */
  router.get('/stats', ctrl.stats);
  /** @legacy GET /api/gis/admin/gis/games/search */
  router.get('/search', validate(v.searchGames), ctrl.search);
  /** @legacy GET /api/gis/providersgis */
  router.get('/providers', validate(v.listProviders), ctrl.providers);

  /**
   * The five curated lobby collections.
   *
   * @legacy GET /api/gis/hotgames
   * @legacy GET /api/gis/livecasino
   * @legacy GET /api/gis/popularslots
   * @legacy GET /api/gis/crashgames
   * @legacy GET /api/gis/indiangames
   */
  router.get('/collections/:collection', validate(v.readCollection), ctrl.collection);

  return router;
};
