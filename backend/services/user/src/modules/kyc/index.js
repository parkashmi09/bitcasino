'use strict';

/**
 * Identity verification.
 *
 * Replaces `legacy/kyc/`, where the status-update endpoint was unauthenticated
 * (any caller could verify any account) and documents were served off the
 * filesystem by guessable filename with no auth. See kyc.service.js.
 */
module.exports = {
  name: 'kyc',
  service: 'user',
  basePath: '/kyc',
  models: ['core'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
