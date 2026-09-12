'use strict';

/**
 * Deposit reporting for staff — crypto and fiat, listed and totalled.
 *
 * Lives in user-service rather than admin-service because user-service owns the
 * payment tables. admin-service owns the staff hierarchy, so the reporting
 * scope is fetched from it over the internal API: each service reads only what
 * it owns, and the answer to "whose players may I see" has one implementation
 * instead of the copy in every legacy report file.
 *
 * All four routes were unauthenticated and took their scope from an
 * `x-staff-id` header.
 */
module.exports = {
  name: 'deposit-reports',
  service: 'user',
  basePath: '/history',
  models: ['core', 'payments'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
