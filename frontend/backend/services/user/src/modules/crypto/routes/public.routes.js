'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');

const v = require('../crypto.validators');
const { CryptoService } = require('../crypto.service');
const { createControllers } = require('../controllers');

/**
 * The provider webhook and the public coin metadata.
 *
 * `public` is an AUDIENCE — no guard is attached, which is correct: CCPayment
 * cannot carry our token, and the webhook authenticates itself by signature.
 *
 * ── THREE NODE CALLBACKS ARE DELIBERATELY NOT HERE ───────────────────────
 *
 *     GET /walletNotify      → WalletNotify.update(io, req._parsedUrl.query)
 *     GET /blockNotify       → BlockNotify.update(io, req._parsedUrl.query)
 *     GET /crypto_callbacks  → Deposit.update(io, req._parsedUrl.query)
 *
 * All three take their entire payload from a raw query string, pass it to a
 * Socket.io-coupled updater, and answer `*ok*` — with `Access-Control-Allow-
 * Origin: *` set on each, which is meaningless for a server-to-server callback
 * and only widens who can reach them from a browser. None is authenticated or
 * signed in any way.
 *
 * They belong to a wallet daemon (`walletnotify`/`blocknotify` are bitcoind
 * hook names) that this port has no visibility into, and their handlers write
 * balances through a socket layer whose ownership is still open — see the
 * blueprint's Socket.io section. Porting them blind would mean reproducing an
 * unauthenticated balance write against a component nobody can currently test.
 * They stay unported and are called out here rather than quietly dropped.
 */
module.exports = function publicRoutes(deps) {
  const service = new CryptoService(deps);
  const ctrl = createControllers({ service });
  const router = Router();

  router.post('/ccpayment/callback', ctrl.webhook);

  router.get('/coins', validate(v.coinDetails), ctrl.coinDetails);
  router.get('/chains', ctrl.chains);

  return router;
};
