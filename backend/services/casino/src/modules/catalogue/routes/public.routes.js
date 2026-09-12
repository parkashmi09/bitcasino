'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../catalogue.validators');
const { CatalogueService } = require('../catalogue.service');
const { createControllers } = require('../controllers');

/**
 * Browsing the lobby.
 *
 * `public` is the AUDIENCE — a visitor sees the games before they have an
 * account, so these carry no guard, and that was true in legacy too. What was
 * NOT acceptable is that the same routes made an uncached upstream call every
 * time, so anyone could use them to have this server hammer the provider on
 * their behalf. The client caches now.
 */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: new CatalogueService(deps) });
  const router = Router();

  /** @legacy GET /api/games/list, /api/gis/games, /api/gis/games/provider */
  router.get('/games', validate(v.localGames), ctrl.localGames);

  /** @legacy GET /api/gis/providers */
  router.get('/vendors', validate(v.localVendors), ctrl.localVendors);

  /** @legacy GET /api/casino/vendors */
  router.get('/hub/vendors', validate(v.hubVendors), ctrl.hubVendors);

  /** @legacy GET /api/casino/games/list */
  router.get('/hub/games', validate(v.hubGames), ctrl.hubGames);

  /** @legacy GET /api/casino/games/lists */
  router.get('/hub/featured', validate(v.hubFeatured), ctrl.hubFeatured);

  /** @legacy GET /api/casino/jackpots */
  router.get('/jackpots', validate(v.jackpots), ctrl.jackpots);

  /** @legacy GET /game-list, /game-list-new */
  router.get('/nexus/games', validate(v.nexusGames), ctrl.nexusGames);

  return router;
};
