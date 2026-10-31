'use strict';

const { Router } = require('express');
const { validate, refuseCustomCurrencies } = require('@ibitplay/common');

const v = require('../xCasino.validators');
const { XCasinoService } = require('../xCasino.service');
const { createControllers } = require('../controllers');
const { requireGameEntitled } = require('../../games/gameEntitlement');
const gamesErrors = require('../../games/games.errors');

/**
 * The launched game must be an enabled `apigames` row, and its vendor is the
 * row's. The client's `vendor` picked the plan flags, the launch host and the
 * stored `game_runs.vendor`, so a switched-off vendor's game opened by naming
 * any other vendor.
 */
const catalogued = ({ models }) =>
  async function cataloguedGame(req, _res, next) {
    try {
      const row = await models.Apigames.findOne({
        where: { id: req.body.gameId, enabled: 1 },
        attributes: ['vendor', 'type'],
        raw: true,
      });
      if (!row) throw gamesErrors.NOT_FOUND({ gameId: req.body.gameId });
      req.game = row;
      req.body.vendor = row.vendor ?? undefined;
      return next();
    } catch (error) {
      return next(error);
    }
  };

/**
 * What a player's own client calls.
 *
 * The loader attaches the player guard to this audience, so `req.user.id` is
 * from a verified token. Legacy served both of these with no middleware and
 * took the account from the request — `user_id` in the body for `/gamerun`,
 * which meant a game session could be opened against anyone's balance, and a
 * query parameter for the balance read.
 */
module.exports = function userRoutes(deps) {
  const { config, logger } = deps;
  const ctrl = createControllers({ service: new XCasinoService(deps), config, logger });

  const router = Router();

  // Custom coins (owner-created, no provider behind them) never reach this module: CURRENCY_NOT_SUPPORTED_FOR_GAMES.

  router.use(refuseCustomCurrencies('GAMES'));

  // The owner's plan — see `games/gameEntitlement.js`. `gameId` is this
  // provider's own number, so the vendor comes from our `apigames` row for it.
  const entitled = requireGameEntitled(deps, (req) => ({ provider: req.body.vendor, type: req.game?.type }));

  /** @legacy POST /api/casino/gamerun */
  router.post('/launch', validate(v.openGame), catalogued(deps), entitled, ctrl.openGame);

  /** @legacy GET /api/casino/casino-balance */
  router.get('/balance', validate(v.myBalance), ctrl.myBalance);

  return router;
};

module.exports.catalogued = catalogued;
