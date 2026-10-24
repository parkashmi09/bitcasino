'use strict';

/**
 * What kind of account an operator action targets.
 *
 * Legacy spelled these `'STAFF'` and anything-else-means-player, checked with
 * `if (userType === 'STAFF')` in five places. Named, and validated against the
 * pair rather than falling through.
 */
const ACCOUNT_TYPE = Object.freeze({ STAFF: 'staff', USER: 'user' });
const ACCOUNT_TYPES = Object.freeze(Object.values(ACCOUNT_TYPE));

/** Account states, matching what `staff.status` and `users.status` hold. */
const ACCOUNT_STATUS = Object.freeze(['active', 'suspended', 'inactive']);
const BET_STATUS = Object.freeze(['active', 'suspended']);

const PASSWORD_ROUNDS = 12;

module.exports = { ACCOUNT_TYPE, ACCOUNT_TYPES, ACCOUNT_STATUS, BET_STATUS, PASSWORD_ROUNDS };
