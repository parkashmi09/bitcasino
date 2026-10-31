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
});

const WITHDRAW_STATUSES = Object.freeze(Object.values(WITHDRAW_STATUS));

/** Statuses that release the held funds back to the player. */
const REFUNDING_STATUSES = Object.freeze([WITHDRAW_STATUS.REJECTED]);

const PERMISSION = Object.freeze({
  READ: 'withdrawals:read',
  APPROVE: 'withdrawals:approve',
});

module.exports = { WITHDRAW_STATUS, WITHDRAW_STATUSES, REFUNDING_STATUSES, PERMISSION };
