'use strict';

/**
 * Deposit review states.
 *
 * The legacy code wrote 'pending' / 'approved' / 'rejected' as bare literals in
 * nine places across two tables. One of those literals was on a table that does
 * not carry the column being set — see fiatDeposit.service.js.
 */
const DEPOSIT_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

const DEPOSIT_STATUSES = Object.freeze(Object.values(DEPOSIT_STATUS));

/** Accepted proof-of-payment uploads, checked by magic bytes rather than declared type. */
const MAGIC_BYTES = Object.freeze([
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
]);

const ALLOWED_MIME = Object.freeze(['image/jpeg', 'image/png', 'application/pdf']);
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

const PERMISSION = Object.freeze({
  READ: 'deposits:read',
  APPROVE: 'deposits:approve',
});

module.exports = {
  DEPOSIT_STATUS,
  DEPOSIT_STATUSES,
  MAGIC_BYTES,
  ALLOWED_MIME,
  MAX_SCREENSHOT_BYTES,
  PERMISSION,
};
