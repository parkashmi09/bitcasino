'use strict';

/** Where a provider transaction can end up. */
const PSP_STATUS = Object.freeze({
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  EXPIRED: 'expired',
});

/** Direction of a provider transaction. */
const FLOW = Object.freeze({ PAY_IN: 'payin', PAY_OUT: 'payout' });

/**
 * How much drift is tolerated between the amount a provider reports and the
 * amount recorded when the deposit was created.
 *
 * Zero. Some providers deduct their fee before reporting, and the temptation is
 * to allow a small delta — but a tolerance is a window an attacker aims at, and
 * a fee is a known, per-provider figure that belongs in the adapter, not in a
 * fuzzy comparison. If a provider genuinely reports net-of-fee, its adapter
 * should return the gross figure.
 */
const AMOUNT_TOLERANCE = '0';

/**
 * Every spelling of "this transaction is finished and was paid" that exists in
 * the four provider tables.
 *
 * Four integrations, written at different times by different hands, agreed on
 * nothing: UPI writes `success`, A-Pay writes `Success`, CricPay writes
 * `Successful`, and WayPay writes the integer 1. A `=== 'success'` test — which
 * is what the first version of this module used — is true for exactly one of
 * them, and the consequence of getting it wrong is not a failed request but a
 * SECOND credit: a settled transaction that does not look settled is re-settled
 * on the provider's next retry.
 *
 * Compared lower-cased, so a row written by the legacy process during the
 * cutover reads the same as one written here.
 */
const SETTLED_STATUSES = new Set(['success', 'successful', 'completed', 'paid']);

module.exports = { PSP_STATUS, FLOW, AMOUNT_TOLERANCE, SETTLED_STATUSES };
