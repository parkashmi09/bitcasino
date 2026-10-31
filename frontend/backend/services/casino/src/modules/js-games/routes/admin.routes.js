'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../jsGames.validators');
const { buildJsGamesService } = require('../jsGames.factory');
const { createControllers } = require('../controllers');

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
  const router = Router();

  /** @legacy POST /jsGames/game/transfer */
  router.post(
    '/v1/transfer',
    auth.requirePermission(PERMISSIONS.WALLET_CREDIT),
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

  return router;
};
