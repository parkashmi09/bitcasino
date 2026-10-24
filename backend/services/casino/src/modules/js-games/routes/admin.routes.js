'use strict';

const { Router } = require('express');
const { validate, requireTxnPassword } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../jsGames.validators');
const cv = require('../jsCuration.validators');
const { buildJsGamesService } = require('../jsGames.factory');
const { JsCurationService } = require('../jsCuration.service');
const { createControllers } = require('../controllers');
const { createCurationControllers } = require('../controllers/curation');

/**
 * Operator actions.
 *
 * `POST /v1/transfer` is the one that mattered: legacy was unauthenticated,
 * took the player from the body, and told the provider to credit that account
 * WITHOUT touching `credits`. Balance appeared at the provider out of nothing.
 *
 * The other two dumped every player's activity to anyone who asked.
 *
 * ── AND A STAFF TOKEN ALONE WAS NOT ENOUGH EITHER ───────────────────────
 *
 * Requiring authentication fixed "anyone", but every route here then accepted
 * any staff account regardless of grant — so the transfer was reachable by an
 * executive holding read-only permissions.
 *
 * `wallet:credit` is the right grant for the transfer specifically. It moves
 * balance to a player at the provider, which is the same authority as crediting
 * a wallet directly, and it should cost the same permission — otherwise this
 * route is a way around `wallet:credit` rather than an instance of it.
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const ctrl = createControllers({ service: buildJsGamesService(deps) });
  const curation = createCurationControllers({ service: new JsCurationService(deps) });
  const router = Router();

  const canRead = auth.requirePermission(PERMISSIONS.CASINO_READ);
  const canManage = auth.requirePermission(PERMISSIONS.CASINO_MANAGE);

  /** @legacy POST /jsGames/game/transfer */
  router.post(
    '/v1/transfer',
    auth.requirePermission(PERMISSIONS.WALLET_CREDIT),
    // Moves the player's wallet: the staff caller's transaction code first.
    requireTxnPassword({ clients: deps.clients }),
    validate(v.transferV1),
    ctrl.transferV1
  );
  /** @legacy POST /jsGames/game/transactions */
  router.post(
    '/v1/transactions',
    auth.requirePermission(PERMISSIONS.CASINO_READ),
    validate(v.transactionsV1),
    ctrl.transactionsV1
  );
  /** @legacy GET /jsGamesv2/historyAdmin */
  router.get('/v2/history', auth.requirePermission(PERMISSIONS.CASINO_READ), ctrl.historyAllV2);

  /* ── Curation ───────────────────────────────────────────────────────
   *
   * NEW. The curation screens in the admin panel wrote against
   * `/admin/casino/games/…`, which orders the AGGREGATOR catalogue —
   * `gisgamesnew`, a table the site does not list and whose `uuid` the
   * launcher cannot open. The lists an operator built there were invisible
   * to every player. These order `js_games`, which is what the lobby renders.
   *
   * The read/write split is `games/routes/admin.routes.js`'s and for the same
   * reason: support staff need to see what is in a collection; rewriting the
   * front page of the casino is a different act from looking at it.
   */
  router.get('/v1/vendors', canRead, curation.vendors);
  router.get('/v1/types', canRead, curation.types);
  router.get('/v1/collections', canRead, curation.collections);

  router.get('/v1/catalogue/search', canRead, validate(cv.searchCatalogue), curation.searchCatalogue);
  router.put('/v1/catalogue/:gameUid/icon', canManage, validate(cv.updateIcon), curation.updateIcon);

  /* `:scope` is `vendor` | `type` | `collection` — one route rather than six,
     matching the single `js_game_curation` table behind it. */
  router.get('/v1/curation/:scope/:key', canRead, validate(cv.readCuration), curation.readCuration);
  router.put('/v1/curation/:scope/:key', canManage, validate(cv.writeCuration), curation.writeCuration);

  return router;
};
