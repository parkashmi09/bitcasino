'use strict';

/**
 * Notification builders shared by more than one call site, so the wording and
 * the idempotency key of one event stay the same wherever it is reported.
 */

/**
 * A staff decision on a withdrawal (fiat or crypto queue).
 *
 * `status` is the queue's own spelling — 'Approved', 'Paid' / 'Sent',
 * 'Rejected'. Anything else (back to 'In Queue') is not news: null.
 */
function withdrawalNotice(source, withdrawalId, status, { amount, currency }, comment) {
  const meta = { amount: amount == null ? null : String(amount), currency, withdrawalId };
  const base = { key: `${source}:${String(status).toLowerCase()}:${withdrawalId}`, link: '#transactions' };
  switch (String(status).toLowerCase()) {
    case 'approved':
      return {
        ...base,
        kind: 'withdrawal_approved',
        title: 'Withdrawal approved',
        body: `Your {amount} withdrawal #${withdrawalId} was approved and is being paid out.`,
        meta,
      };
    case 'paid':
    case 'sent':
      return {
        ...base,
        kind: 'withdrawal_paid',
        title: 'Withdrawal paid',
        body: `Your {amount} withdrawal #${withdrawalId} has been sent.`,
        meta,
      };
    case 'rejected':
      return {
        ...base,
        kind: 'withdrawal_rejected',
        title: 'Withdrawal rejected',
        body:
          `Your {amount} withdrawal #${withdrawalId} was rejected and the funds are back in your wallet.` +
          (comment ? ` Reason: ${comment}` : ''),
        meta: { ...meta, ...(comment ? { reason: comment } : {}) },
      };
    default:
      return null;
  }
}

module.exports = { withdrawalNotice };
