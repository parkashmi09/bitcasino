'use strict';

/**
 * Exchange rates.
 *
 * Replaces `legacy/exchangerate/`, where the three write endpoints had no
 * authentication at all.
 */
module.exports = {
  name: 'exchange-rate',
  service: 'user',
  basePath: '/exchange-rate',
  models: ['core'],
  routers: {
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
    internal: require('./routes/internal.routes'),
  },
};
