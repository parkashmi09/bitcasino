'use strict';

const { Router } = require('express');
const { validate, refuseCustomCurrencies, noBody, asyncHandler, response } = require('@ibitplay/common');

const v = require('../games.validators');
const { GamesService } = require('../games.service');
const { createControllers } = require('../controllers');
const { requireGameEntitled } = require('../gameEntitlement');
const { launchGame } = require('../gameLauncher');

/**
 * A player's own history.
 *
 * Legacy read `?user_id=` on an unauthenticated route, so one request returned
 * any player's game history to anyone who asked. There is no id parameter here.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new GamesService(deps) });
  const router = Router();
  // Custom coins (owner-created, no provider behind them) never reach this module: CURRENCY_NOT_SUPPORTED_FOR_GAMES.
  router.use(refuseCustomCurrencies('GAMES'));

  /**
   * Open any lobby game. New: the owner's casino aggregator (JSGames or Slotegrator) decides
   * whose games the lobby serves, so the front end launches here and the row picks the route.
   */
  router.post(
    '/launch',
    validate(v.launch),
    requireGameEntitled(deps, (req) => ({ uid: req.body.gameUuid }), { mustExist: true }),
    asyncHandler(async (req, res) => response.created(res, await launchGame(deps, { ...req.body, userId: req.user.id })))
  );

  /** @legacy GET /api/gis/games/recently-played */
  router.get('/recently-played', validate(v.recentlyPlayed), ctrl.recentlyPlayed);

  /**
   * Favourites. New — there was no store, no route and no legacy equivalent.
   *
   * ── WHY THESE HANG OFF /casino/games AND NOT /user ───────────────────
   *
   * The obvious path is `/user/favourites`, and it is wrong here. Resolving a
   * favourite means reading `gisgamesnew` and `js_games`, and those are in the
   * `casino` domain, which user-service does not load — the model registry
   * lists exactly which domains each service may touch, with the note that a
   * read crossing a boundary goes over HTTP. Putting the list in user-service
   * would mean an internal HTTP hop on every render of the favourites page to
   * fetch data the casino service already has in hand.
   *
   * So the resource lives with the catalogue it is about. `/casino/games/
   * favourites` is also where `recently-played` already sits, and the two are
   * the same kind of thing: a per-player view over the game catalogue.
   *
   * PUT rather than POST, because starring is idempotent — see `addFavourite`.
   */
  router.get('/favourites', validate(v.listFavourites), ctrl.favourites);
  router.put('/favourites/:gameRef', validate(v.favouriteParam), ctrl.addFavourite);
  router.delete('/favourites/:gameRef', noBody(), validate(v.unfavouriteParam), ctrl.removeFavourite);

  return router;
};
