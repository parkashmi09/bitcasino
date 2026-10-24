'use strict';

/**
 * Gift cards — promotional credit unlocked by depositing and/or wagering.
 *
 * Two things to know before changing anything here:
 *
 *   The claim is a CONDITIONAL UPDATE, not a read-then-write. Legacy checked
 *   the status outside the transaction and credited inside it, so two
 *   simultaneous claims both passed the check and both paid.
 *
 *   The wagering condition is answered by casino-service and sports-service
 *   over the internal API. Legacy queried their tables from here, and the three
 *   features that needed the same number each computed it differently.
 */
module.exports = {
  name: 'gift-cards',
  service: 'user',
  basePath: '/gift-cards',
  models: ['core', 'payments'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
