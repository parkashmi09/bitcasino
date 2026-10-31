'use strict';

/**
 * Site features — which variant of each feature this site offers, and the
 * sealed keys its integrations run on.
 *
 * The menu is packages/common/src/featureCatalogue.js; the selection is this
 * site's `site_features` table. See docs/FEATURE-FLAGS.md.
 */
module.exports = {
  name: 'features',
  service: 'admin',
  basePath: '/features',
  models: ['admin', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
  },
};
