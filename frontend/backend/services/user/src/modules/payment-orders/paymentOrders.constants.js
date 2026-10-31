'use strict';

/**
 * What each provider can actually do.
 *
 * Every one of these tables was previously a literal inside a controller — the
 * currency→payment-system maps, the merchant ids, the validation regexes. That
 * is why the four integrations disagreed about which currencies were supported:
 * nothing forced them to agree, and nothing showed them side by side.
 */

/** Direction of an order. */
const FLOW = Object.freeze({ PAY_IN: 'payin', PAY_OUT: 'payout' });

/** Where an order can be. */
const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

/**
 * WayPay uses a DIFFERENT merchant id per currency. Sending the INR id with a
 * BDT order is rejected by the gateway with a signature error, which is a
 * confusing way to be told the merchant id was wrong.
 *
 * These are account identifiers, not secrets — the signing key is the secret —
 * so they are configuration rather than environment.
 */
const WAYPAY_MERCHANT_IDS = Object.freeze({
  INR: '2591',
  IDR: '1818',
  PHP: '1819',
  BDT: '1820',
  PKR: '1821',
});

/** A-Pay's deposit rails, verified against the live project. */
const APAY_DEPOSIT_SYSTEMS = Object.freeze({
  INR: 'phonepe',
  BDT: 'bkash_api_v',
  PKR: 'easypaisa',
  // NPR has only esewa_p2p enabled, not bare "esewa".
  NPR: 'esewa_p2p',
});

/** A-Pay's payout rails. Deliberately not the same set as deposits. */
const APAY_WITHDRAWAL_SYSTEMS = Object.freeze({
  INR: 'imps',
  BDT: 'bkash_api_v',
  PKR: 'pkr_w',
  NPR: 'esewa_p2p',
});

/**
 * WayPay's numeric result codes.
 *
 * Kept as the provider defines them so a support ticket quoting "code 9" can be
 * answered. Only 0 means success — the legacy code tested `code === 0` in one
 * place and truthiness in another, and truthiness makes every failure look
 * like a success.
 */
const WAYPAY_CODES = Object.freeze({
  0: 'success',
  1: 'failed',
  2: 'merchant id error',
  3: 'account does not exist',
  4: 'account abnormal',
  5: 'signature error',
  6: 'order already exists',
  7: 'order does not exist',
  8: 'no permission',
  9: 'insufficient balance',
  10: 'wrong amount',
  11: 'channel maintenance',
  12: 'currency does not exist',
  13: 'channel does not exist',
  15: 'channel failed',
  16: 'ip not allowed',
  17: 'bank does not exist',
});

/**
 * Payment tables whose user-id column is TEXT rather than a number.
 *
 * Postgres will not compare a varchar to an integer: `WHERE uid = 123` against
 * a varchar column is a type error, not an empty result. Loud, at least — but
 * loud at runtime, in a payment path, which is the wrong place to find out.
 *
 * There is no pattern to which tables did which. `apaydeposits.user_id` is
 * BIGINT and `apaywithdrawals.user_id` is VARCHAR(200) — the same integration,
 * written at the same time, disagreeing with itself. So this is a list, not a
 * rule, and it is checked by `tools/verify-models.js` against the live schema.
 *
 * The right long-term fix is a migration that makes them all BIGINT with a
 * foreign key to `users`. That is a data migration on live payment tables and
 * belongs in its own change, not smuggled into a port.
 */
const USER_ID_IS_TEXT = Object.freeze(
  new Set(['Upideposit', 'Ccdeposit', 'Apaywithdrawals', 'InrDeposit', 'UserKyc'])
);

/** The user id in whatever type this model's column actually is. */
const userIdFor = (modelName, userId) =>
  USER_ID_IS_TEXT.has(modelName) ? String(userId) : userId;

module.exports = {
  FLOW,
  ORDER_STATUS,
  USER_ID_IS_TEXT,
  userIdFor,
  WAYPAY_MERCHANT_IDS,
  APAY_DEPOSIT_SYSTEMS,
  APAY_WITHDRAWAL_SYSTEMS,
  WAYPAY_CODES,
};
