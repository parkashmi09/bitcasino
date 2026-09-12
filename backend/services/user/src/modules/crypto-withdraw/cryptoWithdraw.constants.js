'use strict';

/**
 * Crypto withdrawal states.
 *
 * `In Queue` is written with a space and that casing by
 * `legacy/Users/Rule.js`, which is what creates these rows. Kept verbatim:
 * existing rows carry it and the admin screens match the exact string.
 *
 * The rest of the vocabulary is new. Legacy had none — `status` was whatever
 * string the request body contained — so these are the values the queue is
 * allowed to move to, and anything else is a 422 rather than a silent write.
 */
const STATUS = Object.freeze({
  IN_QUEUE: 'In Queue',
  APPROVED: 'Approved',
  SENT: 'Sent',
  REJECTED: 'Rejected',
});

const STATUSES = Object.freeze(Object.values(STATUS));

/**
 * Which moves are legal from where.
 *
 * A withdrawal that has been sent on-chain cannot be un-sent, so `Sent` and
 * `Rejected` are terminal. Legacy had no transitions at all: a settled
 * withdrawal could be set back to pending and approved a second time, and since
 * approval is what tells an operator to send coin, that is a second payout.
 */
const TRANSITIONS = Object.freeze({
  [STATUS.IN_QUEUE]: [STATUS.APPROVED, STATUS.REJECTED],
  // Approved but not yet broadcast — still recallable.
  [STATUS.APPROVED]: [STATUS.SENT, STATUS.REJECTED],
  [STATUS.SENT]: [],
  [STATUS.REJECTED]: [],
});

/**
 * Statuses that return the held funds.
 *
 * Only rejection. `Sent` means the coin has left, and `Approved` means it is
 * about to — neither gives the money back.
 */
const REFUNDING_STATUSES = Object.freeze([STATUS.REJECTED]);

module.exports = { STATUS, STATUSES, TRANSITIONS, REFUNDING_STATUSES };
