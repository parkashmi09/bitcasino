'use strict';

const { defineErrors } = require('@ibitplay/common');
const { MAX_UPLOAD_BYTES } = require('./p2p.upload');

/**
 * Legacy answered every failure the same way:
 *
 *     catch (err) { res.status(500).json({ error: err.message }); }
 *
 * — a 500 with a raw message for every case, including `'Insufficient balance'`
 * and `'Order not paid'`, which are the client's business and not a server
 * fault. A Postgres constraint violation came back the same way, with the
 * constraint name in the body.
 */
module.exports = defineErrors('P2P', {
  // ── Offers ────────────────────────────────────────────────────────────
  OFFER_NOT_FOUND: { status: 404, message: 'Offer not found' },
  OFFER_INACTIVE: { status: 409, message: 'That offer is no longer available' },
  OFFER_EXHAUSTED: {
    status: 409,
    /**
     * Legacy never decremented `available_amount` at all — it was written at
     * offer creation and read by nothing that could change it, so an offer for
     * 100 USDT could back an unlimited number of orders.
     */
    message: 'That offer does not have enough left',
  },
  BELOW_MIN_LIMIT: { status: 422, message: 'That amount is below the offer minimum' },
  ABOVE_MAX_LIMIT: { status: 422, message: 'That amount is above the offer maximum' },

  // ── Orders ────────────────────────────────────────────────────────────
  ORDER_NOT_FOUND: { status: 404, message: 'Order not found' },
  ORDER_EXPIRED: { status: 409, message: 'That order has expired' },
  ORDER_NOT_PENDING: { status: 409, message: 'That order is no longer waiting for payment' },
  ORDER_NOT_PAID: {
    status: 409,
    // Legacy: `throw new Error('Order not paid')` → 500.
    message: 'That order has not been marked as paid',
  },
  ORDER_ALREADY_SETTLED: {
    status: 409,
    /**
     * The one that mattered. `releaseOrder` read the row, checked the status
     * and updated — with no lock between the read and the write. Two concurrent
     * releases both saw PAID and both credited the wallet.
     */
    message: 'That order has already been settled',
  },

  INSUFFICIENT_BALANCE: { status: 422, message: 'Not enough balance for that sell order' },

  // ── Payment details ───────────────────────────────────────────────────
  PAYMENT_TYPE_NOT_FOUND: { status: 404, message: 'Payment method not found' },
  PAYMENT_ACCOUNT_NOT_FOUND: { status: 404, message: 'Payment account not found' },
  PAYMENT_TYPE_EXISTS: { status: 409, message: 'A payment method with that code already exists' },
  ACCOUNT_NOT_ON_OFFER: {
    status: 422,
    // Legacy took `payment_account_id` from the body and stored it without
    // checking it was one of the accounts the offer actually accepts.
    message: 'That payment account is not accepted by this offer',
  },

  // ── Disputes ──────────────────────────────────────────────────────────
  DISPUTE_NOT_FOUND: { status: 404, message: 'Dispute not found' },
  DISPUTE_EXISTS: {
    status: 409,
    // `createDispute` INSERTed unconditionally, so a retry filed a second one
    // and resolving either left the other open forever.
    message: 'A dispute is already open on that order',
  },
  DISPUTE_CLOSED: { status: 409, message: 'That dispute has been resolved' },

  // ── Uploads ───────────────────────────────────────────────────────────
  NO_FILE: { status: 400, message: 'No image was uploaded' },
  NOT_AN_IMAGE: { status: 415, message: 'That file is not a PNG, JPEG or WebP image' },
  FORMAT_REFUSED: { status: 415, message: 'That image format is not accepted here' },
  TOO_LARGE: {
    status: 413,
    message: `An image may not exceed ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
  },
  TOO_SMALL: {
    status: 400,
    message: 'That upload is too small to be an image — it may have been truncated',
  },
  PROOF_REQUIRED: {
    status: 400,
    /**
     * `markPaid` accepted `req.file` as optional and wrote null. An order in
     * PAID with no proof is one an operator has to release on trust.
     */
    message: 'A payment proof is required',
  },
  NO_IMAGE: { status: 404, message: 'There is no image on that record' },
});
