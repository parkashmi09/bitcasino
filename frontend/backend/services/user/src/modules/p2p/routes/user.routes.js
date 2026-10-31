'use strict';

const { Router } = require('express');
const { validate, createRateLimiter } = require('@ibitplay/common');

const v = require('../p2p.validators');
const errors = require('../p2p.errors');
const { single } = require('../p2p.upload');
const { buildP2pService, buildP2pAdminService } = require('../p2p.factory');
const { createControllers } = require('../controllers');

/**
 * A player's own P2P trading.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT THE GUARD ON THIS ROUTER REPLACES
 *
 * Legacy's eight user routes had none, and three of them named the account:
 *
 *     POST /p2p/create-order         user_id from the BODY
 *     POST /p2p/create-sell-order    user_id from the BODY — and DEBITS it
 *     GET  /p2p/orders/:userId       anyone's trading history
 *     GET  /p2p/sell-orders/:userId  anyone's trading history
 *
 * The loader attaches the player guard here, so `req.user.id` is the account
 * and there is no field on any shape that could name a different one.
 * ═════════════════════════════════════════════════════════════════════════
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({
    service: buildP2pService(deps),
    admin: buildP2pAdminService(deps),
  });
  const router = Router();

  /**
   * Opening an order is bounded per player.
   *
   * A sell order debits the wallet and holds against an offer; a loop over it
   * with no limit locks a player's balance up in pending orders faster than an
   * operator can cancel them.
   */
  const writeLimiter = createRateLimiter({
    name: 'p2p-write',
    windowMs: 60_000,
    max: 30,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  // ── Reads ───────────────────────────────────────────────────────────
  /** @legacy GET /p2p/offers */
  router.get('/offers', validate(v.offers), ctrl.offers);
  /** @legacy GET /p2p/orders/:userId */
  router.get('/orders', validate(v.myOrders), ctrl.myOrders);
  /** @legacy GET /p2p/sell-orders/:userId */
  router.get('/sell-orders', validate(v.myOrders), ctrl.mySellOrders);

  /**
   * Literal segments first.
   *
   * `/orders/:orderId/proof` must be declared before `/order/:orderId` cannot
   * shadow it — Express matches in declaration order, and this codebase has
   * already been bitten twice by a parameter route capturing a literal one.
   */
  router.get('/orders/:orderId/proof', validate(v.orderDetails), ctrl.orderProof);
  router.get('/sell-orders/:orderId/qr', validate(v.orderDetails), ctrl.sellQr);
  router.get('/disputes/:disputeId/screenshot', validate(v.disputeParam), ctrl.disputeScreenshot);

  /** @legacy GET /p2p/order/:orderId — legacy had no ownership check */
  router.get('/order/:orderId', validate(v.orderDetails), ctrl.orderDetails);

  // ── Writes ──────────────────────────────────────────────────────────
  /** @legacy POST /p2p/create-order */
  router.post('/orders', writeLimiter, validate(v.createOrder), ctrl.createOrder);

  /**
   * @legacy POST /p2p/create-sell-order
   *
   * multipart — the seller's QR image. The upload runs after the guard the
   * loader attached, so an unauthenticated request never has its body read.
   */
  router.post(
    '/sell-orders',
    writeLimiter,
    ...single('qr_image', errors),
    validate(v.createSellOrder),
    ctrl.createSellOrder
  );

  /** @legacy POST /p2p/mark-paid/:orderId — the proof is required now */
  router.post(
    '/orders/:orderId/paid',
    writeLimiter,
    ...single('file', errors),
    validate(v.markPaid),
    ctrl.markPaid
  );

  /** @legacy POST /p2p/dispute */
  router.post('/disputes', writeLimiter, ...single('screenshot', errors), validate(v.createDispute), ctrl.createDispute);

  return router;
};
