'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * Every user-side handler takes its account from `req.user.id`.
 *
 * That is the single change that closes the largest hole in the legacy module:
 * `createOrder` and `createSellOrder` read `user_id` from the BODY, and
 * `getUserOrders`/`getUserSellOrders` read it from the PATH — on routes with no
 * authentication. A sell order DEBITS the named account immediately.
 */

/** Bytes, not the platform envelope — these are `<img src>` targets. */
function sendImage(res, image) {
  res.set({
    'Content-Type': image.contentType,
    'Content-Length': String(image.byteSize),
    /**
     * A payment proof is another player's bank screenshot. It must not sit in
     * a shared cache, and it must not be sniffed into something executable.
     */
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.send(image.data);
}

function createControllers({ service, admin }) {
  return {
    // ── Player reads ──────────────────────────────────────────────────

    /** @legacy GET /p2p/offers */
    offers: asyncHandler(async (req, res) => {
      const result = await service.offers(req.query);
      return response.paginated(res, result, req.query);
    }),

    /** @legacy GET /p2p/orders/:userId — the id was in the PATH */
    myOrders: asyncHandler(async (req, res) => {
      const result = await service.myOrders({ userId: req.user.id, ...req.query });
      return response.paginated(res, result, req.query);
    }),

    /** @legacy GET /p2p/sell-orders/:userId — likewise */
    mySellOrders: asyncHandler(async (req, res) => {
      const result = await service.mySellOrders({ userId: req.user.id, ...req.query });
      return response.paginated(res, result, req.query);
    }),

    /** @legacy GET /p2p/order/:orderId — no ownership check in legacy */
    orderDetails: asyncHandler(async (req, res) =>
      response.ok(res, await service.orderDetails({ userId: req.user.id, orderId: req.params.orderId }))
    ),

    // ── Player writes ─────────────────────────────────────────────────

    /** @legacy POST /p2p/create-order — took `user_id` from the body */
    createOrder: asyncHandler(async (req, res) =>
      response.created(res, await service.createOrder({ userId: req.user.id, ...req.body }))
    ),

    /** @legacy POST /p2p/create-sell-order — took `user_id` from the body, and DEBITS */
    createSellOrder: asyncHandler(async (req, res) =>
      response.created(res, await service.createSellOrder({ userId: req.user.id, ...req.body, file: req.file }))
    ),

    /** @legacy POST /p2p/mark-paid/:orderId */
    markPaid: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.markPaid({ userId: req.user.id, ...req.params, ...req.body, file: req.file })
      )
    ),

    /** @legacy POST /p2p/dispute */
    createDispute: asyncHandler(async (req, res) =>
      response.created(res, await service.createDispute({ userId: req.user.id, ...req.body, file: req.file }))
    ),

    orderProof: asyncHandler(async (req, res) =>
      sendImage(res, await service.proofImage({ userId: req.user.id, kind: 'order', id: req.params.orderId }))
    ),
    sellQr: asyncHandler(async (req, res) =>
      sendImage(res, await service.proofImage({ userId: req.user.id, kind: 'sell', id: req.params.orderId }))
    ),
    disputeScreenshot: asyncHandler(async (req, res) =>
      sendImage(res, await service.proofImage({ userId: req.user.id, kind: 'dispute', id: req.params.disputeId }))
    ),

    // ── Operator ──────────────────────────────────────────────────────

    /** @legacy POST /admin/p2p/payment-type */
    createPaymentType: asyncHandler(async (req, res) =>
      response.created(res, await admin.createPaymentType({ staff: req.staff, ...req.body }))
    ),
    /** @legacy GET /admin/p2p/payment-types */
    paymentTypes: asyncHandler(async (_req, res) => response.ok(res, await admin.paymentTypes())),

    /** @legacy POST /admin/p2p/payment-account */
    createPaymentAccount: asyncHandler(async (req, res) =>
      response.created(res, await admin.createPaymentAccount({ staff: req.staff, ...req.body, file: req.file }))
    ),
    /** @legacy GET /admin/p2p/payment-accounts */
    paymentAccounts: asyncHandler(async (_req, res) => response.ok(res, await admin.paymentAccounts())),

    /** @legacy POST /admin/p2p/create-offer */
    createOffer: asyncHandler(async (req, res) =>
      response.created(res, await admin.createOffer({ staff: req.staff, ...req.body }))
    ),
    /** @legacy GET /admin/p2p/offers */
    adminOffers: asyncHandler(async (req, res) => {
      const result = await admin.offers(req.query);
      return response.paginated(res, result, req.query);
    }),
    /** Not a legacy endpoint — an offer could never be taken down. */
    setOfferStatus: asyncHandler(async (req, res) =>
      response.ok(res, await admin.setOfferStatus({ staff: req.staff, ...req.params, ...req.body }))
    ),

    /** @legacy GET /admin/p2p/orders */
    adminOrders: asyncHandler(async (req, res) => {
      const result = await admin.orders(req.query);
      return response.paginated(res, result, req.query);
    }),
    /** @legacy POST /admin/p2p/release/:orderId — credits the wallet */
    releaseOrder: asyncHandler(async (req, res) =>
      response.ok(res, await admin.releaseOrder({ staff: req.staff, ...req.params, ...req.body }))
    ),
    /** @legacy POST /admin/p2p/cancel/:orderId */
    cancelOrder: asyncHandler(async (req, res) =>
      response.ok(res, await admin.cancelOrder({ staff: req.staff, ...req.params, ...req.body }))
    ),
    /** @legacy PUT /admin/p2p/order/:orderId/status — took any string */
    setOrderStatus: asyncHandler(async (req, res) =>
      response.ok(res, await admin.setOrderStatus({ staff: req.staff, ...req.params, ...req.body }))
    ),

    /** @legacy GET /admin/p2p/sell-orders */
    adminSellOrders: asyncHandler(async (req, res) => {
      const result = await admin.sellOrders(req.query);
      return response.paginated(res, result, req.query);
    }),
    /** @legacy POST /admin/p2p/sell-release/:orderId */
    releaseSellOrder: asyncHandler(async (req, res) =>
      response.ok(res, await admin.releaseSellOrder({ staff: req.staff, ...req.params, ...req.body, file: req.file }))
    ),
    /** @legacy POST /admin/p2p/sell-cancel/:orderId — the double refund */
    cancelSellOrder: asyncHandler(async (req, res) =>
      response.ok(res, await admin.cancelSellOrder({ staff: req.staff, ...req.params, ...req.body }))
    ),

    /** @legacy GET /admin/p2p/disputes */
    adminDisputes: asyncHandler(async (req, res) => {
      const result = await admin.disputes(req.query);
      return response.paginated(res, result, req.query);
    }),
    /** @legacy PUT /admin/p2p/dispute/:disputeId/status */
    setDisputeStatus: asyncHandler(async (req, res) =>
      response.ok(res, await admin.setDisputeStatus({ staff: req.staff, ...req.params, ...req.body }))
    ),

    adminOrderProof: asyncHandler(async (req, res) =>
      sendImage(res, await admin.proofImage({ kind: 'order', id: req.params.orderId }))
    ),
    adminSellProof: asyncHandler(async (req, res) =>
      sendImage(res, await admin.proofImage({ kind: 'sell', id: req.params.orderId }))
    ),
    adminSellQr: asyncHandler(async (req, res) =>
      sendImage(res, await admin.proofImage({ kind: 'qr', id: req.params.orderId }))
    ),
    adminDisputeScreenshot: asyncHandler(async (req, res) =>
      sendImage(res, await admin.proofImage({ kind: 'dispute', id: req.params.disputeId }))
    ),
  };
}

module.exports = { createControllers };
