'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * Note the shape of every handler below: `req.user.id` is passed explicitly and
 * `req.body` is spread AFTER nothing that could override it. There is no path
 * by which a body field becomes the user id.
 */
function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });

  return {
    /**
     * @legacy POST /remotes/create-deposit
     * @legacy POST /cricpay/payment-request
     * @legacy POST /api/payments/payin/initiate
     * @legacy POST /create-order            (UPI, inline in index.js)
     */
    createDeposit: asyncHandler(async (req, res) =>
      response.created(res, await service.createDeposit({ ...req.body, userId: req.user.id }))
    ),

    /**
     * @legacy POST /remotes/create-withdrawal
     * @legacy POST /cricpay/payout-request
     * @legacy POST /api/payments/payout/initiate
     *
     * All three were unauthenticated and took the user id from the body.
     */
    createWithdrawal: asyncHandler(async (req, res) =>
      response.created(res, await service.createWithdrawal({ ...req.body, userId: req.user.id }))
    ),

    /**
     * @legacy GET /api/payments/payin/status/:out_trade_no
     * @legacy GET /api/payments/payout/status/:out_trade_no
     * @legacy GET /remotes/deposit-info
     */
    getOrder: asyncHandler(async (req, res) =>
      response.ok(res, await service.getOrder({ ...req.params, userId: req.user.id }))
    ),

    /** @legacy POST /cricpay/check-transaction-status */
    refreshStatus: asyncHandler(async (req, res) =>
      response.ok(res, await service.refreshStatus({ ...req.params, userId: req.user.id }))
    ),

    listOrders: asyncHandler(async (req, res) =>
      response.paginated(
        res,
        await service.listOrders({ ...req.query, userId: req.user.id }),
        page(req.query)
      )
    ),

    /** @legacy GET /cricpay/check-payment-status */
    availableMethods: asyncHandler(async (req, res) =>
      response.ok(res, await service.getAvailableMethods(req.params))
    ),

    // ── Staff ─────────────────────────────────────────────────────────

    /** @legacy POST /api/payments/utr/repair — was unauthenticated */
    repairUtr: asyncHandler(async (req, res) =>
      response.ok(res, await service.repairUtr({ ...req.body, staffId: req.staff?.id }))
    ),

    /** Any player's orders, for support. */
    listUserOrders: asyncHandler(async (req, res) =>
      response.paginated(
        res,
        await service.listOrders({ ...req.query, userId: req.params.userId }),
        page(req.query)
      )
    ),
  };
}

module.exports = { createControllers };
