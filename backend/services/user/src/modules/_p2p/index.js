'use strict';

/**
 * Peer-to-peer trading.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `legacy/peerTrade/routes.js` IS NEVER MOUNTED. Twenty-one routes, thirteen
 * of them under `/admin/p2p/`, and not one middleware in the file. Four of
 * them move real money or destroy the record of it:
 *
 *     POST   /admin/p2p/release/:orderId       credits crypto to a wallet
 *     POST   /admin/p2p/sell-cancel/:orderId   refunds — repeatedly
 *     POST   /admin/p2p/sell-release/:orderId  completes a fiat payout
 *     DELETE /admin/p2p/order/:orderId         deletes a settled trade
 *
 * The five defects that would have cost money, in order of size:
 *
 *   1. `UPDATE credits SET ${order.coin} = ${order.coin} + $1` — a value from
 *      an unauthenticated request body, interpolated as a COLUMN NAME. Fourth
 *      instance of this pattern in the platform.
 *
 *   2. `releaseOrder` read the row, checked `status === 'PAID'` and credited,
 *      with no row lock. Inside a BEGIN, which made it look transactional.
 *      Two concurrent calls both credited.
 *
 *   3. `cancelSellOrder` refused only when the status was RELEASED, so
 *      cancelling a CANCELLED order refunded the crypto again.
 *
 *   4. `createSellOrder` compared a float balance in one statement and debited
 *      in another. Two concurrent sells both passed the check.
 *
 *   5. No ledger row for any of it. Every movement was a bare UPDATE.
 *
 * Money moves through `wallet.debit`/`wallet.credit` here: a currency CODE
 * rather than a column, a guarded `WHERE balance >= amount`, a ledger row, and
 * an idempotency key derived from the order number so a retry cannot pay twice.
 *
 * Also closed: `user_id` from the body on the two order-creating routes and
 * from the path on the two history routes; `payment_account_id` stored without
 * checking it was on the offer; `available_amount` never decremented, so one
 * offer backed unlimited orders; `expires_at` computed for the client and never
 * enforced by the server; disputes filed twice by a retry; `updateOrderStatus`
 * writing any string to the column that every guard reads.
 *
 * The uploads — payment proofs, QR codes, dispute screenshots — are the
 * EVIDENCE in a disagreement over money. `legacy/peerTrade/middleware.js` is
 * nine lines of `multer.diskStorage` with no `fileFilter` at all, storing a
 * filename in a VARCHAR. The bytes are in the row now (migration 033) after a
 * content check, so they survive a restart and cannot be an HTML document.
 *
 * Schema comes from migration 009 — RECONSTRUCTED from the queries, because
 * none of these tables existed in the baseline or in either live database.
 * Read its header before trusting the column types.
 * ─────────────────────────────────────────────────────────────────────────
 */
module.exports = {
  name: 'p2p',
  service: 'user',
  basePath: '/p2p',
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
