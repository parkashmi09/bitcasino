'use strict';

/**
 * Two-factor authentication.
 *
 * Replaces `legacy/2fa/routes.js` — five endpoints, no authentication on any of
 * them, user id taken from the request body.
 */
module.exports = {
  name: 'twofa',
  service: 'user',
  basePath: '/2fa',
  models: ['core'],
  routers: { user: require('./routes/user.routes') },
};
