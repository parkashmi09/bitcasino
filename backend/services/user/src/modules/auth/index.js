'use strict';

/**
 * Player authentication module.
 *
 * Replaces the login handling in `legacy/index.js` and `legacy/Users/Token.js`,
 * where the "session" was a row in `tokens` with no expiry, no revocation and
 * no device record — enough to say a token existed and nothing else.
 */
module.exports = {
  name: 'auth',
  service: 'user',
  basePath: '/auth',
  models: ['core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
  },
};
