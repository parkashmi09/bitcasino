'use strict';

/**
 * Player profile.
 *
 * Collects four handlers that lived inline in `legacy/index.js`, all of which
 * took the uid from the request with no authentication.
 */
module.exports = {
  name: 'profile',
  service: 'user',
  basePath: '/profile',
  models: ['core'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
  },
};
