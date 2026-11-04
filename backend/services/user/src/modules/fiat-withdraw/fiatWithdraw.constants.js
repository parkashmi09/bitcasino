'use strict';

/**
 * Withdrawal states. Legacy wrote 'In Queue' with a space and mixed casing —
 * kept verbatim because the admin UI matches on the exact string.
 */
const WITHDRAW_STATUS = Object.freeze({
  IN_QUEUE: 'In Queue',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAID: 'Paid',
  // The player withdrew the request while it was still In Queue (POST /user/withdrawals/fiat/:id/cancel).
  CANCELLED: 'Cancelled',
});

const WITHDRAW_STATUSES = Object.freeze(Object.values(WITHDRAW_STATUS));

/** What staff may set (POST /admin/user/withdrawals/fiat/status). Cancelled is the player's alone. */
const STAFF_STATUSES = Object.freeze(WITHDRAW_STATUSES.filter((s) => s !== WITHDRAW_STATUS.CANCELLED));

/** Statuses that release the held funds back to the player. */
const REFUNDING_STATUSES = Object.freeze([WITHDRAW_STATUS.REJECTED]);

/**
 * Where a request may go from each status. Approved means "about to pay", so it
 * still moves on to Paid (it went out) or Rejected (it could not be paid, funds
 * return). Paid and Rejected are final.
 */
const NEXT_STATUSES = Object.freeze({
  [WITHDRAW_STATUS.IN_QUEUE]: Object.freeze([WITHDRAW_STATUS.APPROVED, WITHDRAW_STATUS.REJECTED, WITHDRAW_STATUS.PAID]),
  [WITHDRAW_STATUS.APPROVED]: Object.freeze([WITHDRAW_STATUS.PAID, WITHDRAW_STATUS.REJECTED]),
  [WITHDRAW_STATUS.PAID]: Object.freeze([]),
  [WITHDRAW_STATUS.REJECTED]: Object.freeze([]),
  [WITHDRAW_STATUS.CANCELLED]: Object.freeze([]),
});

const PERMISSION = Object.freeze({
  READ: 'withdrawals:read',
  APPROVE: 'withdrawals:approve',
});

module.exports = { WITHDRAW_STATUS, WITHDRAW_STATUSES, STAFF_STATUSES, REFUNDING_STATUSES, NEXT_STATUSES, PERMISSION };
