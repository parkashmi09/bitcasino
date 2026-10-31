'use strict';

/**
 * Internal currency swap.
 *
 * Replaces `legacy/internalswap/`, whose controller interpolated the request's
 * currency directly into `UPDATE credits SET ${currency} = ...` with no
 * validation and no authentication — arbitrary SQL against the balance table.
 * See swap.service.js for the detail.
 */
module.exports = {
  name: 'swap',
  service: 'user',
  basePath: '/swap',
  models: ['core'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
