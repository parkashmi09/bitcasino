'use strict';

module.exports = {
  name: 'promotions',
  service: 'admin',
  basePath: '/promotions',
  models: ['admin'],
  routers: {
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
  },
};
