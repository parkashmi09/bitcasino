'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../p2p.validators');
const errors = require('../p2p.errors');
const { single } = require('../p2p.upload');
const { buildP2pAdminService } = require('../p2p.factory');
const { createControllers } = require('../controllers');

/**
 * P2P administration.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIRTEEN ROUTES, NO MIDDLEWARE, THREE OF THEM MOVING REAL MONEY
 *
 * `legacy/peerTrade/routes.js` registers everything under `/admin/p2p/` with
 * exactly the same amount of authentication as the user routes: none. Anyone
 * reaching the port could have called
 *
 *     POST /admin/p2p/release/:orderId       → credits crypto
 *     POST /admin/p2p/sell-cancel/:orderId   → refunds crypto, repeatedly
 *     DELETE /admin/p2p/order/:orderId       → destroys the record of a trade
 *
 * Every route here needs a permission, and every route that touches money is
 * audited. The audit row is not decoration: `released_by` did not exist in the
 * schema because there was never an operator to record, and the first question
 * after a wrongful release is who authorised it.
 *
 * ── TWO LEGACY ROUTES ARE NOT HERE ───────────────────────────────────────
 *
 * `DELETE /admin/p2p/order/:orderId` — see the note in `p2p.validators.js`.
 * Deleting a RELEASED order destroys the only record that crypto was paid out,
 * while the wallet ledger row survives with nothing to reconcile against.
 * Cancelling exists and refunds correctly.
 *
 * The DUPLICATE `POST /admin/p2p/sell-release/:orderId` — legacy registered it
 * twice, once with multer and once without. Express matches the first, so the
 * second never ran.
 * ═════════════════════════════════════════════════════════════════════════
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: null, admin: buildP2pAdminService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  /**
   * Two permissions, not one.
   *
   * Configuring rails and offers is a settings change; releasing crypto to a
   * player's wallet is a money movement, and the platform already separates
   * those everywhere else.
   */
  const canConfigure = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);
  const canMoveMoney = auth.requirePermission(PERMISSIONS.WALLET_ADJUST);

  const auditOrder = (action, targetType = 'P2P_ORDER') =>
    withActivity({
      action,
      describe: (req) => ({
        targetType,
        targetId: req.params.orderId,
        details: { note: req.body?.note ?? null },
      }),
    });

  // ── Payment rails ───────────────────────────────────────────────────
  /** @legacy GET /admin/p2p/payment-types */
  router.get('/payment-types', canConfigure, ctrl.paymentTypes);
  /** @legacy POST /admin/p2p/payment-type */
  router.post(
    '/payment-types',
    canConfigure,
    validate(v.createPaymentType),
    withActivity({
      action: 'p2p.payment_type.create',
      describe: (req) => ({ targetType: 'P2P_PAYMENT_TYPE', targetId: req.body.code, details: {} }),
    }),
    ctrl.createPaymentType
  );

  /** @legacy GET /admin/p2p/payment-accounts */
  router.get('/payment-accounts', canConfigure, ctrl.paymentAccounts);
  /**
   * @legacy POST /admin/p2p/payment-account
   *
   * multipart — the QR image. The permission check runs BEFORE multer, so an
   * unauthorised request never has its body buffered.
   */
  router.post(
    '/payment-accounts',
    canConfigure,
    ...single('qr_image', errors),
    validate(v.createPaymentAccount),
    withActivity({
      action: 'p2p.payment_account.create',
      describe: (req) => ({
        targetType: 'P2P_PAYMENT_ACCOUNT',
        targetId: null,
        // The account number is not put in the audit log — it is the thing
        // being protected, and an audit trail is read by more people than the
        // record it describes.
        details: { paymentTypeId: req.body.paymentTypeId },
      }),
    }),
    ctrl.createPaymentAccount
  );

  // ── Offers ──────────────────────────────────────────────────────────
  /** @legacy GET /admin/p2p/offers */
  router.get('/offers', canConfigure, validate(v.adminList), ctrl.adminOffers);
  /** @legacy POST /admin/p2p/create-offer */
  router.post(
    '/offers',
    canConfigure,
    validate(v.createOffer),
    withActivity({
      action: 'p2p.offer.create',
      describe: (req) => ({
        targetType: 'P2P_OFFER',
        targetId: null,
        details: { coin: req.body.coin, fiat: req.body.fiat, price: req.body.price },
      }),
    }),
    ctrl.createOffer
  );
  /** Not a legacy endpoint — an offer could never be taken down. */
  router.patch(
    '/offers/:offerId/status',
    canConfigure,
    validate(v.setOfferStatus),
    withActivity({
      action: 'p2p.offer.status',
      describe: (req) => ({
        targetType: 'P2P_OFFER',
        targetId: req.params.offerId,
        details: { status: req.body.status },
      }),
    }),
    ctrl.setOfferStatus
  );

  // ── Buy orders ──────────────────────────────────────────────────────
  /** @legacy GET /admin/p2p/orders */
  router.get('/orders', canConfigure, validate(v.adminList), ctrl.adminOrders);
  router.get('/orders/:orderId/proof', canConfigure, validate(v.orderId), ctrl.adminOrderProof);

  /**
   * @legacy POST /admin/p2p/release/:orderId
   *
   * The one that pays out. `wallet:adjust`, audited, and the service holds the
   * row FOR UPDATE — legacy did the read and the write with nothing between
   * them, so two concurrent calls both credited.
   */
  router.post('/orders/:orderId/release', canMoveMoney, validate(v.releaseOrder), auditOrder('p2p.order.release'), ctrl.releaseOrder);
  /** @legacy POST /admin/p2p/cancel/:orderId */
  router.post('/orders/:orderId/cancel', canMoveMoney, validate(v.cancelOrder), auditOrder('p2p.order.cancel'), ctrl.cancelOrder);
  /** @legacy PUT /admin/p2p/order/:orderId/status — took any string */
  router.patch(
    '/orders/:orderId/status',
    canConfigure,
    validate(v.updateOrderStatus),
    withActivity({
      action: 'p2p.order.status',
      describe: (req) => ({
        targetType: 'P2P_ORDER',
        targetId: req.params.orderId,
        details: { status: req.body.status },
      }),
    }),
    ctrl.setOrderStatus
  );

  // ── Sell orders ─────────────────────────────────────────────────────
  /** @legacy GET /admin/p2p/sell-orders */
  router.get('/sell-orders', canConfigure, validate(v.adminList), ctrl.adminSellOrders);
  router.get('/sell-orders/:orderId/proof', canConfigure, validate(v.orderId), ctrl.adminSellProof);
  router.get('/sell-orders/:orderId/qr', canConfigure, validate(v.orderId), ctrl.adminSellQr);

  /** @legacy POST /admin/p2p/sell-release/:orderId — registered TWICE in legacy */
  router.post(
    '/sell-orders/:orderId/release',
    canMoveMoney,
    ...single('admin_payment_proof', errors),
    validate(v.releaseSellOrder),
    auditOrder('p2p.sell.release', 'P2P_SELL_ORDER'),
    ctrl.releaseSellOrder
  );

  /**
   * @legacy POST /admin/p2p/sell-cancel/:orderId
   *
   * THE DOUBLE REFUND. Legacy checked only `status === 'RELEASED'`, so
   * cancelling a CANCELLED order refunded again, every time it was called.
   */
  router.post(
    '/sell-orders/:orderId/cancel',
    canMoveMoney,
    validate(v.cancelOrder),
    auditOrder('p2p.sell.cancel', 'P2P_SELL_ORDER'),
    ctrl.cancelSellOrder
  );

  // ── Disputes ────────────────────────────────────────────────────────
  /** @legacy GET /admin/p2p/disputes */
  router.get('/disputes', canConfigure, validate(v.adminList), ctrl.adminDisputes);
  router.get('/disputes/:disputeId/screenshot', canConfigure, validate(v.disputeParam), ctrl.adminDisputeScreenshot);
  /** @legacy PUT /admin/p2p/dispute/:disputeId/status */
  router.patch(
    '/disputes/:disputeId/status',
    canConfigure,
    validate(v.updateDisputeStatus),
    withActivity({
      action: 'p2p.dispute.status',
      describe: (req) => ({
        targetType: 'P2P_DISPUTE',
        targetId: req.params.disputeId,
        details: { status: req.body.status },
      }),
    }),
    ctrl.setDisputeStatus
  );

  return router;
};
