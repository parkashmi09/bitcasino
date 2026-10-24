'use strict';

/**
 * The `apigames` vendor catalogue.
 *
 * Three read-only endpoints over a table the sync fills. No money and no
 * upstream calls, which is why it is small — but two real defects:
 *
 *   The vendor page count was cached for ten minutes while the rows were
 *   queried live, so after any catalogue change the paginator advertised pages
 *   that did not exist and hid games that did.
 *
 *   The search counted with a DIFFERENT parameter list from the one it
 *   selected with (`params.slice(0, paramIndex - 1)`), so the total described a
 *   different filter than the results.
 */
module.exports = {
  name: 'x-gaming',
  service: 'casino',
  basePath: '/x-gaming',
  models: ['casino'],
  routers: {
    public: require('./routes/public.routes'),
  },
};
