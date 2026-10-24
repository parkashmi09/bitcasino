'use strict';

/**
 * Region restriction — whether this visitor's country is one the site serves.
 *
 * The setting is the platform owner's (the `region_restriction` policy plus the document's
 * `region`, see packages/common/src/regionPolicy.js); this module answers the public question
 * `GET /api/v1/user/region` and gives the auth module its `block`-mode refusal.
 */
module.exports = {
  name: 'region',
  service: 'user',
  basePath: '/region',
  models: ['core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
  },
};
