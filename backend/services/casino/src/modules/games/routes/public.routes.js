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
  /** A provider's logo as uploaded in the site admin (migration 067). An `<img src>`, not an envelope. */
  router.get('/providers/:name/logo', validate(v.providerLogo), ctrl.providerLogo);
  /** A game's tile art self-hosted by `scripts/fix-game-artwork.js --brand` (`game_artwork`, migration 098). */
  router.get('/image/:name', validate(v.artworkName), ctrl.artwork);

  /**
   * The four curated lobby collections.
   *
   * @legacy GET /api/gis/hotgames
   * @legacy GET /api/gis/livecasino
   * @legacy GET /api/gis/popularslots
   * @legacy GET /api/gis/crashgames
   */
  router.get('/collections/:collection', validate(v.readCollection), ctrl.collection);

  /**
   * One game, by uuid — the game screen's read.
   *
   * ── WHY THIS IS NOT `GET /:uuid` ─────────────────────────────────────
   *
   * It was, declared last so the specific routes above it won. That is enough
   * WITHIN this file and nowhere near enough across the module: the loader
   * mounts `public` before `user`, both on `/casino/games`, so a bare
   * `/:uuid` also sat in front of every route in `user.routes.js`.
   * `/favourites` and `/recently-played` arrived here as uuids and answered
   * `404 Game not found` — a player's starred games came back empty on every
   * page load, which looked like favourites not persisting.
   *
   * A segment of its own cannot shadow anything, in this file or a later one,
   * and does not depend on declaration order to be correct.
   */
  router.get('/detail/:uuid', validate(v.uuidParam), ctrl.byUuid);

  /** One game by its page slug (`gates-of-olympus-by-pragmatic`), for /casino/game/<slug>. */
  router.get('/slug/:slug', validate(v.slugParam), ctrl.bySlug);

  return router;
};
