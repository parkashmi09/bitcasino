'use strict';

/**
 * The whitelabel hub (docs/plans/2026-11-01-whitelabel-plan-and-casino-hub.md, Part C).
 *
 * On the PARENT, a copy's gateway payments run on the parent's gateway account:
 *   public  GET  /api/v1/user/wl-hub/payments/terms     the copy's charges, per gateway it may use
 *   public  POST /api/v1/user/wl-hub/payments/deposit   open a deposit order (payment-orders hubDeposit)
 *   public  POST /api/v1/user/wl-hub/payments/payout    send a payout (payment-orders hubPayout)
 *   public  GET  /api/v1/user/wl-hub/payments/order     what became of one of its orders
 * psp settles the provider's callback like any other and the outcome is pushed to the copy
 * (delivery.js; the `wl-hub:deliver` job retries).
 *
 * On a COPY:
 *   public  POST /api/v1/user/wl-hub/in/payments        the parent reports an outcome (psp applyHubEvent)
 *
 * "public" = no player token. Every call is signed with the copy's key and secret
 * (common/hubAuth) and must come straight to this service, not through a proxy.
 */
module.exports = {
  name: 'wl-hub',
  service: 'user',
  basePath: '/wl-hub',
  models: ['core', 'payments', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
  },
  jobs: [
    {
      name: 'wl-hub:deliver',
      intervalMs: Number(process.env.WL_HUB_DELIVER_INTERVAL_MS || 30_000),
      run: (container) => require('./delivery').deliverPending(container),
    },
  ],
};
