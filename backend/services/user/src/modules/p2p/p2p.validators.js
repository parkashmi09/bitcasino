'use strict';

const { z } = require('@ibitplay/common');

const {
  SUPPORTED_COINS,
  SUPPORTED_FIAT,
  SEGMENT,
  ORDER_STATUS,
  SELL_STATUS,
  DISPUTE_STATUS,
  OFFER_STATUS,
  MIN_PAYMENT_MINUTES,
  MAX_PAYMENT_MINUTES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} = require('./p2p.constants');

/**
 * P2P validators.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE FIELD THAT IS MISSING FROM EVERY USER SHAPE: `user_id`
 *
 * `createOrder` and `createSellOrder` both read it from the request body, on
 * routes with no authentication:
 *
 *     const { user_id, offer_id, crypto_amount, ... } = req.body;
 *
 * So one POST placed an order against any account — and for a SELL order that
 * DEBITS the named account's crypto immediately. `getUserOrders/:userId` and
 * `getUserSellOrders/:userId` read anyone's trading history the same way, from
 * the path.
 *
 * The id comes from the token everywhere here. There is no shape below that
 * can carry one.
 * ═════════════════════════════════════════════════════════════════════════
 */

const id = z.coerce.number().int().positive();

/**
 * An amount of money, as an exact decimal string.
 *
 * Never a JS number: legacy compared `wallet.rows[0][offer.coin] < crypto_amount`
 * and multiplied `crypto_amount * offer.price` in IEEE-754 doubles, then wrote
 * the product to a NUMERIC(30,8) column.
 */
const amount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, 'An amount is a decimal with up to 8 places')
  .refine((value) => Number(value) > 0, 'An amount must be greater than zero');

/** Same shape, but accepting what multipart sends (everything is a string). */
const price = amount;

const coin = z.enum(SUPPORTED_COINS);
const fiat = z.enum(SUPPORTED_FIAT);

const paging = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
};

// ── Public / user reads ─────────────────────────────────────────────────

/** @legacy GET /p2p/offers */
const offers = {
  query: z
    .object({
      ...paging,
      coin: coin.optional(),
      fiat: fiat.optional(),
      segment: z.enum(Object.values(SEGMENT)).optional(),
    })
    .strict(),
};

/**
 * @legacy GET /p2p/orders/:userId
 * @legacy GET /p2p/sell-orders/:userId
 *
 * The path parameter is gone. It was the account whose orders you got.
 */
const myOrders = {
  query: z
    .object({
      ...paging,
      status: z.enum(Object.values({ ...ORDER_STATUS, ...SELL_STATUS })).optional(),
    })
    .strict(),
};

/** @legacy GET /p2p/order/:orderId */
const orderDetails = { params: z.object({ orderId: id }).strict() };

/** A dispute id in the path — the screenshot route and the status route. */
const disputeParam = { params: z.object({ disputeId: id }).strict() };

// ── User writes ─────────────────────────────────────────────────────────

/**
 * @legacy POST /p2p/create-order — a BUY: fiat out, crypto in on release.
 */
const createOrder = {
  body: z
    .object({
      offerId: id,
      cryptoAmount: amount,
      /**
       * Which of the offer's accepted accounts to pay into.
       *
       * Legacy stored whatever id the body named without checking it was on
       * the offer at all, so a buyer could be shown — and pay — an account that
       * had nothing to do with the trade.
       */
      paymentAccountId: id,
    })
    .strict(),
};

/**
 * @legacy POST /p2p/create-sell-order — crypto is DEBITED here, immediately.
 *
 * multipart/form-data: it carries the seller's QR image.
 */
const createSellOrder = {
  body: z
    .object({
      offerId: id,
      cryptoAmount: amount,
      paymentTypeId: id,
      accountName: z.string().trim().min(1).max(255).optional(),
      accountNumber: z.string().trim().min(1).max(100).optional(),
      ifscCode: z.string().trim().min(1).max(50).optional(),
      upiId: z.string().trim().min(1).max(255).optional(),
    })
    .strict()
    .refine((body) => body.accountNumber || body.upiId, {
      message: 'Provide an account number or a UPI id to be paid into',
    }),
};

/**
 * @legacy POST /p2p/mark-paid/:orderId
 *
 * The proof is REQUIRED. Legacy accepted `req.file` as optional and wrote null,
 * which left an order in PAID that an operator had to release on trust.
 */
const markPaid = {
  params: z.object({ orderId: id }).strict(),
  body: z
    .object({
      utrNumber: z.string().trim().min(4).max(100),
    })
    .strict(),
};

/** @legacy POST /p2p/dispute */
const createDispute = {
  body: z
    .object({
      orderId: id,
      orderType: z.enum(['BUY', 'SELL']),
      reason: z.string().trim().min(1).max(100),
      message: z.string().trim().max(4000).optional(),
    })
    .strict(),
};

// ── Admin ───────────────────────────────────────────────────────────────

/** @legacy POST /admin/p2p/payment-type */
const createPaymentType = {
  body: z
    .object({
      name: z.string().trim().min(1).max(100),
      /** An identifier, not free text — it is compared against, not displayed. */
      code: z
        .string()
        .trim()
        .min(1)
        .max(50)
        .regex(/^[a-z0-9][a-z0-9_-]*$/, 'A code is lowercase letters, digits, dash and underscore'),
    })
    .strict(),
};

/** @legacy POST /admin/p2p/payment-account */
const createPaymentAccount = {
  body: z
    .object({
      paymentTypeId: id,
      accountName: z.string().trim().min(1).max(255).optional(),
      accountNumber: z.string().trim().min(1).max(100).optional(),
      ifscCode: z.string().trim().min(1).max(50).optional(),
      upiId: z.string().trim().min(1).max(255).optional(),
      extraDetails: z.string().trim().max(2000).optional(),
    })
    .strict()
    .refine((body) => body.accountNumber || body.upiId, {
      message: 'A payment account needs an account number or a UPI id',
    }),
};

/**
 * @legacy POST /admin/p2p/create-offer
 *
 * `coin` was interpolated into SQL as a column name from this body. It is an
 * enum now, and the wallet resolves the column — the value never reaches SQL.
 */
const createOffer = {
  body: z
    .object({
      coin,
      fiat,
      price,
      availableAmount: amount,
      minLimit: amount.optional(),
      maxLimit: amount.optional(),
      /**
       * The display name on the offer.
       *
       * Legacy did `username.charAt(0).toUpperCase()` with no check, so an
       * offer created without one threw a TypeError and returned 500.
       */
      username: z.string().trim().min(1).max(255),
      paymentAccountIds: z.array(id).min(1).max(20),
      paymentTime: z.coerce.number().int().min(MIN_PAYMENT_MINUTES).max(MAX_PAYMENT_MINUTES).optional(),
      segment: z.enum(Object.values(SEGMENT)).default(SEGMENT.BUY),
      isFeatured: z.coerce.boolean().default(false),
      isVerified: z.coerce.boolean().default(false),
      isKycVerified: z.coerce.boolean().default(false),
    })
    .strict()
    .refine((body) => !body.minLimit || !body.maxLimit || Number(body.minLimit) <= Number(body.maxLimit), {
      message: 'The minimum cannot exceed the maximum',
    }),
};

const setOfferStatus = {
  params: z.object({ offerId: id }).strict(),
  body: z.object({ status: z.enum(Object.values(OFFER_STATUS)) }).strict(),
};

const orderId = { params: z.object({ orderId: id }).strict() };

/** @legacy POST /admin/p2p/release/:orderId — credits the buyer's wallet. */
const releaseOrder = {
  params: z.object({ orderId: id }).strict(),
  body: z.object({ note: z.string().trim().max(2000).optional() }).strict(),
};

/** @legacy POST /admin/p2p/cancel/:orderId */
const cancelOrder = {
  params: z.object({ orderId: id }).strict(),
  body: z.object({ note: z.string().trim().max(2000).optional() }).strict(),
};

/** @legacy POST /admin/p2p/sell-release/:orderId — multipart, carries the proof. */
const releaseSellOrder = {
  params: z.object({ orderId: id }).strict(),
  body: z.object({ note: z.string().trim().max(2000).optional() }).strict(),
};

/**
 * @legacy PUT /admin/p2p/order/:orderId/status
 *
 * ── DELIBERATELY NARROWER THAN LEGACY ────────────────────────────────────
 *
 * `updateOrderStatus` took any string and wrote it to the column. That is a
 * route to set an order to `RELEASED` WITHOUT crediting the wallet, or back to
 * `PENDING` after a release so it can be released again. The status is what
 * every guard in this module reads.
 *
 * Only the two transitions that move no money are allowed here. Releasing and
 * cancelling have their own endpoints, which do the money and the status in one
 * transaction.
 */
const updateOrderStatus = {
  params: z.object({ orderId: id }).strict(),
  body: z
    .object({
      status: z.enum([ORDER_STATUS.DISPUTED, ORDER_STATUS.EXPIRED]),
      note: z.string().trim().max(2000).optional(),
    })
    .strict(),
};

/** @legacy PUT /admin/p2p/dispute/:disputeId/status */
const updateDisputeStatus = {
  params: z.object({ disputeId: id }).strict(),
  body: z
    .object({
      status: z.enum(Object.values(DISPUTE_STATUS)),
      adminNote: z.string().trim().max(4000).optional(),
    })
    .strict(),
};

/** The admin listings. Legacy paged none of them. */
const adminList = {
  query: z
    .object({
      ...paging,
      status: z.string().trim().max(20).optional(),
      userId: z.string().trim().max(100).optional(),
      coin: coin.optional(),
    })
    .strict(),
};

/**
 * `DELETE /admin/p2p/order/:orderId` IS NOT PORTED.
 *
 * `deleteOrder` ran `DELETE FROM p2p_orders WHERE id=$1` with no status check
 * and no authentication. Deleting a RELEASED order destroys the only record
 * that the platform paid crypto out — the wallet ledger row survives, and there
 * is then nothing to reconcile it against.
 *
 * Cancelling exists and refunds correctly; setting a status exists for the
 * cases that move no money. Neither destroys the trade.
 */

module.exports = {
  offers,
  myOrders,
  orderDetails,
  disputeParam,
  createOrder,
  createSellOrder,
  markPaid,
  createDispute,
  createPaymentType,
  createPaymentAccount,
  createOffer,
  setOfferStatus,
  orderId,
  releaseOrder,
  cancelOrder,
  releaseSellOrder,
  updateOrderStatus,
  updateDisputeStatus,
  adminList,
};
