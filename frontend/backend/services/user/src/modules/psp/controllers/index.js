'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    /**
     * @legacy POST /webhook/paymentstatuspui
     * @legacy POST /remotes/webhook
     * @legacy POST /cricpay/payment-callback
     * @legacy POST /api/payments/payin/callback
     *
     * Providers expect a plain body, not the platform envelope — most check for
     * a literal "success" string and retry on anything else. The shape each one
     * wants is small and provider-specific, so it is produced here rather than
     * through `response.ok`.
     */
    callback: asyncHandler(async (req, res) => {
      const result = await service.handleCallback({
        provider: req.params.provider,
        body: req.body,
        ip: req.ip,
      });

      if (req.params.provider === 'waypay') return res.send('success');
      return res.json({ status: true, ...result });
    }),

    /**
     * @legacy POST /remotes/withdrawal-webhook
     * @legacy POST /api/payments/payout/callback
     */
    payoutCallback: asyncHandler(async (req, res) => {
      const result = await service.handlePayoutCallback({
        provider: req.params.provider,
        body: req.body,
        ip: req.ip,
      });

      if (req.params.provider === 'waypay') return res.send('success');
      return res.json({ status: true, ...result });
    }),

    /**
     * @legacy GET /api/payments/payin/status/:out_trade_no
     * @legacy GET /cricpay/check-payment-status
     */
    myStatus: asyncHandler(async (req, res) =>
      response.ok(res, await service.getStatus({ ...req.params, userId: req.user.id }))
    ),

    /** Staff lookup — any player's transaction. */
    status: asyncHandler(async (req, res) =>
      response.ok(res, await service.getStatus({ ...req.params, userId: null }))
    ),
  };
}

module.exports = { createControllers };
