'use strict';

/**
 * The four fiat deposit tables, described rather than UNION'd.
 *
 * Legacy joined these with a `UNION ALL` that had to cast `currency::text` and
 * `status::text` in every branch, because the four tables agree on neither the
 * column names, the types, nor the status vocabulary. The cast was needed to
 * stop Postgres failing with "could not determine data type of parameter $1".
 *
 * Describing the differences here instead means each is queried through its own
 * model, and the awkwardness is visible in one table rather than buried in a
 * 200-line string.
 *
 * A fifth spelling of the same idea would be a good moment to stop and unify
 * these tables properly.
 */

/** What every provider's status vocabulary maps onto. */
const BUCKET = Object.freeze({ SUCCESS: 'success', PENDING: 'pending', FAILED: 'failed', OTHER: 'other' });

const SOURCES = Object.freeze([
  {
    provider: 'waypay',
    model: 'PayInTransactions',
    idColumn: 'id',
    userColumn: 'user_id',
    referenceColumn: 'out_trade_no',
    userIdIsText: false,
    // Numeric statuses. Note these are the STRINGS Sequelize will compare
    // against a SMALLINT column, so they are given as numbers.
    statusValues: { success: [1], pending: [0], failed: [2] },
  },
  {
    provider: 'apay',
    model: 'Apaydeposits',
    idColumn: 'id',
    userColumn: 'user_id',
    referenceColumn: 'custom_transaction_id',
    userIdIsText: false,
    statusValues: { success: ['Success'], pending: ['Pending'], failed: ['Failed', 'Rejected'] },
  },
  {
    provider: 'manual',
    model: 'FiatDeposits',
    idColumn: 'deposit_id',
    userColumn: 'user_id',
    referenceColumn: 'transaction_id',
    userIdIsText: false,
    statusValues: { success: ['approved', 'Approved'], pending: ['pending', 'Pending'], failed: ['rejected', 'Rejected'] },
  },
  {
    provider: 'cricpay',
    model: 'Cricpaytransactions',
    idColumn: 'id',
    userColumn: 'uid',
    referenceColumn: 'transaction_code',
    userIdIsText: false,
    // INR only — so a report filtered to another currency excludes this source
    // entirely rather than returning its INR rows.
    currency: 'INR',
    statusValues: { success: ['Successful'], pending: ['Pending', 'Processing'], failed: ['Failed', 'Rejected', 'Error'] },
  },
]);

/** Which bucket a raw provider status falls into. */
function statusBucket(provider, status) {
  const s = String(status ?? '').toLowerCase();

  if (provider === 'waypay') {
    if (s === '1') return BUCKET.SUCCESS;
    if (s === '0') return BUCKET.PENDING;
    if (s === '2') return BUCKET.FAILED;
    return BUCKET.OTHER;
  }

  if (['success', 'successful', 'approved', 'completed', 'paid'].includes(s)) return BUCKET.SUCCESS;
  if (['pending', 'processing', 'created'].includes(s)) return BUCKET.PENDING;
  if (['failed', 'rejected', 'error', 'cancelled', 'expired'].includes(s)) return BUCKET.FAILED;
  return BUCKET.OTHER;
}

/**
 * CCPayment's coin ids → ticker, for reading `ccdeposit.coinid` back.
 *
 * The deployment's `CCPAYMENT_COIN_IDS` is asked first (it is what issued the
 * id); this is the fallback for rows minted before that was configured. Same
 * table as admin-service's `dashboard.constants.COIN_IDS`, which the finance
 * charts value crypto deposits with — keep the two in step.
 */
const CCPAYMENT_COINS = Object.freeze({
  1155: 'BTC',
  1161: 'ETH',
  1173: 'LTC',
  1169: 'BCH',
  1280: 'USDT',
  1482: 'TRX',
  1492: 'DOGE',
  1375: 'ADA',
  1331: 'XRP',
  1168: 'BNB',
  1282: 'USDC',
  1864: 'SHIB',
});

/**
 * `fiat_withdrawals` statuses that count as withdrawn, lower-case (compare
 * LOWER(status)): Approved OR Paid. Until ebfcdc0 a bank withdrawal moved once,
 * In Queue → Approved, and Approved was the payout; since then it goes on to
 * Paid. Both mean the operator released the money, and legacy rows stop at
 * Approved. A copy of admin-service's `dashboard.constants.js`
 * WITHDRAWAL_DONE.fiat_withdrawals, which every admin report reads and this
 * service cannot require: keep the two in step.
 */
const FIAT_WITHDRAWN = Object.freeze(['approved', 'paid', 'sent', 'done', 'success', 'completed', 'complete']);

module.exports = { SOURCES, BUCKET, statusBucket, CCPAYMENT_COINS, FIAT_WITHDRAWN };
