'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('VAULT', {
  DEPOSIT_NOT_FOUND: { status: 404, message: 'Vault deposit not found' },
  LOCK_PERIOD_NOT_FOUND: { status: 404, message: 'That lock period is not available' },
  LOCK_PERIOD_EXISTS: { status: 409, message: 'A lock period with this key already exists' },
  STILL_LOCKED: {
    status: 409,
    message: 'This deposit is still within its lock period',
  },
  ALREADY_WITHDRAWN: { status: 409, message: 'This deposit has already been withdrawn' },
  NOTHING_TO_WITHDRAW: { status: 409, message: 'This deposit has no balance to withdraw' },
  INSUFFICIENT_BALANCE: { status: 402, message: 'Insufficient balance to move into the vault' },
  BELOW_MINIMUM: { status: 422, message: 'The amount is below the vault minimum' },
  LOCK_PERIOD_IN_USE: {
    status: 409,
    // Deleting a term with open deposits would orphan them — their rate and
    // maturity would no longer resolve to anything.
    message: 'This lock period has open deposits and cannot be removed',
  },
  EARLY_WITHDRAWAL_NOT_ALLOWED: {
    status: 409,
    message: 'Early withdrawal is not available for this deposit',
  },
  EARLY_WITHDRAWAL_FORBIDDEN: {
    status: 409,
    message: 'This deposit is already matured — withdraw without the early-exit penalty',
  },
});
