'use strict';

/**
 * Payment orders — the OUTBOUND half of the four provider integrations.
 *
 * `modules/psp` handles callbacks coming in; this handles requests going out.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ONE MODULE AND NOT FOUR
 *
 * The legacy code had a directory per provider, and the four drifted apart in
 * the way that mattered most: only one of the three payout endpoints checked a
 * balance, and none of the three was authenticated.
 *
 *   POST /remotes/create-withdrawal   debits the user named in the BODY and
 *                                     pays out to the bank account in the body
 *   POST /cricpay/payout-request      pays out with NO balance check at all
 *   POST /api/payments/payout/initiate ditto
 *
 * The first drains any player's balance to an attacker's bank account. The
 * other two do not touch a player's balance because they never look at one —
 * they send an instruction to the provider and the money leaves the merchant
 * float.
 *
 * Sharing one service is what stops that: authentication, limits, KYC, the
 * balance hold and the refund-on-failure are written once and every provider
 * gets them. A gateway adapter cannot opt out, because it is never handed a
 * user id — only an amount and a destination the service has already checked.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * All of these providers had their live production credentials committed to the
 * repository. They are configuration here, and the old values must be rotated.
 */
module.exports = {
  name: 'payment-orders',
  service: 'user',
  basePath: '/payments',
  models: ['core', 'payments', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
