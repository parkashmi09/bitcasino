'use strict';

/**
 * What kind of sub-login this is.
 *
 * The column has a CHECK constraint permitting these two, so they are the
 * schema's values, not this module's preference.
 */
const EXECUTIVE_KIND = Object.freeze({ EXECUTIVE: 'executive', MARKETING: 'marketing' });
const EXECUTIVE_KINDS = Object.freeze(Object.values(EXECUTIVE_KIND));

/** Also a CHECK constraint on the column. */
const EXECUTIVE_STATUS = Object.freeze({ ACTIVE: 'active', INACTIVE: 'inactive', LOCKED: 'locked' });
const EXECUTIVE_STATUSES = Object.freeze(Object.values(EXECUTIVE_STATUS));

/**
 * Cost factor for a sub-login password.
 *
 * Same as staff: this credential carries staff authority, so it is priced like
 * one. Legacy used 10 here and 10 for staff, with a six-character minimum.
 */
const PASSWORD_ROUNDS = 12;

module.exports = { EXECUTIVE_KIND, EXECUTIVE_KINDS, EXECUTIVE_STATUS, EXECUTIVE_STATUSES, PASSWORD_ROUNDS };
