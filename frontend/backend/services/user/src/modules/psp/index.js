'use strict';

/**
 * Payment-provider integrations: WayPay, A-Pay, CricPay and UPI Gateway.
 *
 * One module with per-provider adapters rather than four near-identical
 * modules. The blueprint proposed the latter; this is a deliberate deviation,
 * because the four legacy handlers differed in exactly the way that mattered —
 * how carefully they authenticated the caller — and three of them duplicated
 * settlement logic that only needs to exist once.
 *
 * The fourth, UPI, had no authentication at all: `POST /webhook/paymentstatuspui`
 * credited `req.body.amount` to a wallet on the strength of `req.body.status`.
 * See providers/index.js.
 */
module.exports = {
  name: 'psp',
  service: 'user',
  basePath: '/psp',
  models: ['core', 'payments', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
