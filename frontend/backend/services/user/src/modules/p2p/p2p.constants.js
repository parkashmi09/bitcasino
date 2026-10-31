'use strict';

/**
 * Peer-to-peer trading — constants.
 *
 * Every string here was a literal inside a query or a comparison in
 * `legacy/peerTrade/controler.js`. Naming them is not tidiness: a status typo
 * in a WHERE clause matches zero rows, and in a release routine that reads as
 * "this order does not exist" rather than as an error.
 */

/**
 * A BUY order: the player sends fiat, the platform releases crypto.
 *
 *   PENDING  → created, waiting for the player to pay
 *   PAID     → the player says they paid and uploaded a proof
 *   RELEASED → an operator checked the proof and credited the crypto
 *   CANCELLED / EXPIRED → no crypto moved
 *   DISPUTED → an operator must decide
 */
const ORDER_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PAID: 'PAID',
  RELEASED: 'RELEASED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  DISPUTED: 'DISPUTED',
});

/**
 * A SELL order: the platform takes the crypto up front and pays fiat out.
 *
 * The crypto is debited when the order is created, which is why a cancel has to
 * refund and why cancelling twice was a live double-refund in legacy.
 */
const SELL_STATUS = Object.freeze({
  PENDING: 'PENDING',
  RELEASED: 'RELEASED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  DISPUTED: 'DISPUTED',
});

/** Statuses from which an order can still go either way. */
const OPEN_ORDER_STATUSES = Object.freeze([ORDER_STATUS.PENDING, ORDER_STATUS.PAID, ORDER_STATUS.DISPUTED]);
const OPEN_SELL_STATUSES = Object.freeze([SELL_STATUS.PENDING, SELL_STATUS.DISPUTED]);

/** Which side of the book an offer is on. */
const SEGMENT = Object.freeze({ BUY: 'BUY', SELL: 'SELL' });

const OFFER_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', CLOSED: 'CLOSED' });

const DISPUTE_STATUS = Object.freeze({
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED: 'RESOLVED',
  REJECTED: 'REJECTED',
});

const DISPUTE_ORDER_TYPE = Object.freeze({ BUY: 'BUY', SELL: 'SELL' });

/**
 * The currencies a P2P trade may settle in.
 *
 * ── WHY THIS LIST EXISTS AT ALL ──────────────────────────────────────────
 *
 * Legacy moved the money with:
 *
 *     UPDATE credits SET ${order.coin} = ${order.coin} + $1 WHERE uid = $2
 *
 * `order.coin` is copied from `p2p_offers.coin`, which is copied from the body
 * of `POST /admin/p2p/create-offer` — an unauthenticated route. So a value a
 * caller chose was interpolated into SQL as a COLUMN NAME. That is the fourth
 * instance of this exact pattern in the platform (the vault and the casino
 * balance path carried the others).
 *
 * The wallet takes a currency CODE here and resolves the column itself, so the
 * value never reaches SQL. This list is what an offer may name.
 */
const SUPPORTED_COINS = Object.freeze(['USDT', 'INR', 'BTC', 'ETH', 'TRX']);

/** Fiat currencies an offer may be priced in. */
const SUPPORTED_FIAT = Object.freeze(['INR', 'USD', 'PKR', 'NPR', 'BDT']);

/**
 * How long a buyer has to pay, in minutes, when an offer does not say.
 *
 * Legacy's fallback was `offer.payment_time || 30` at the order site and a
 * column default of 15 in the reconstructed schema — two different answers to
 * one question. The column default wins here, and this is only used when the
 * column itself is null.
 */
const DEFAULT_PAYMENT_MINUTES = 15;
const MIN_PAYMENT_MINUTES = 5;
const MAX_PAYMENT_MINUTES = 24 * 60;

/** Ledger reasons. These appear in the player's statement. */
const REASON = Object.freeze({
  SELL_HOLD: 'p2p_sell_hold',
  SELL_REFUND: 'p2p_sell_refund',
  BUY_RELEASE: 'p2p_buy_release',
});

/** Page sizes for the listings. Legacy paged none of them. */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

module.exports = {
  ORDER_STATUS,
  SELL_STATUS,
  OPEN_ORDER_STATUSES,
  OPEN_SELL_STATUSES,
  SEGMENT,
  OFFER_STATUS,
  DISPUTE_STATUS,
  DISPUTE_ORDER_TYPE,
  SUPPORTED_COINS,
  SUPPORTED_FIAT,
  DEFAULT_PAYMENT_MINUTES,
  MIN_PAYMENT_MINUTES,
  MAX_PAYMENT_MINUTES,
  REASON,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
};
