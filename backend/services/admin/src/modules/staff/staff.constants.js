'use strict';

/** Which way money is moving relative to the account initiating it. */
const TRANSFER_DIRECTION = Object.freeze({
  /** The actor pays a descendant. */
  DEPOSIT: 'deposit',
  /** The actor pulls money back up from a descendant. */
  WITHDRAW: 'withdraw',
});

const TRANSFER_DIRECTIONS = Object.freeze(Object.values(TRANSFER_DIRECTION));

/** Who a transfer can involve. Legacy validated this inline in the handler. */
const TARGET_TYPE = Object.freeze({ STAFF: 'staff', USER: 'user' });
const TARGET_TYPES = Object.freeze(Object.values(TARGET_TYPE));

/** Staff balances are INR only — `staff_balances` has one money column. */
const BALANCE_CURRENCY = 'INR';

const STAFF_STATUS = Object.freeze(['active', 'suspended', 'inactive']);

/**
 * Cost factor for a staff password.
 *
 * Higher than the OTP factor (8) because this guards a credential rather than
 * a short-lived code, and staff logins are rare enough that the extra work is
 * not a lever an attacker can pull at volume.
 */
const PASSWORD_ROUNDS = 12;

module.exports = {
  TRANSFER_DIRECTION, TRANSFER_DIRECTIONS,
  TARGET_TYPE, TARGET_TYPES,
  BALANCE_CURRENCY, STAFF_STATUS, PASSWORD_ROUNDS,
};
